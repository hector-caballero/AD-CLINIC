-- =============================================================================
-- AD Clinic · Odontograma interactivo y presupuesto dental
-- -----------------------------------------------------------------------------
-- Contenido:
--   1. Tipos: dentición, cara dental y estado clínico del ítem
--   2. Tablas:
--      - `odontograms`: un mapa dental por paciente y dentición
--      - `odontogram_items`: un procedimiento sobre una pieza/cara, con el
--        precio congelado en guaraníes (PYG) al momento de presupuestar
--   3. Validación FDI: permanente 11-48 y temporal 51-85, según la dentición
--      del odontograma; sella `performed_at` al pasar a `completed`
--   4. Índices de consulta y anti-duplicados
--   5. Trigger de `updated_at`
--   6. Helper `can_manage_odontograms()` y RLS:
--      - SELECT: cualquier integrante activo (recepción cotiza el presupuesto)
--      - INSERT/UPDATE/DELETE: solo `dentist` y `admin`
--   7. Permisos (GRANT/REVOKE) y recarga de la caché de PostgREST
--
-- Estados (`odontogram_item_status`):
--   pending   → patología / pendiente (rojo)
--   budgeted  → presupuestado (verde)
--   completed → realizado (azul)
--   absent    → pieza ausente (gris, se dibuja con una X)
--
-- `surface` en NULL significa «pieza completa»; las caras posibles son las
-- cinco clásicas: oclusal/incisal, vestibular, lingual/palatino, mesial y distal.
--
-- Re-ejecutable (IF NOT EXISTS / DROP ... IF EXISTS / CREATE OR REPLACE).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'dentition_kind' and typnamespace = 'public'::regnamespace
  ) then
    create type public.dentition_kind as enum (
      'permanent',  -- dentición permanente (FDI 11-48)
      'temporary'   -- dentición temporal / decidua (FDI 51-85)
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typname = 'tooth_surface' and typnamespace = 'public'::regnamespace
  ) then
    create type public.tooth_surface as enum (
      'occlusal',    -- oclusal / incisal
      'vestibular',  -- vestibular (bucal o labial)
      'lingual',     -- lingual / palatino
      'mesial',      -- mesial (hacia la línea media)
      'distal'       -- distal (alejada de la línea media)
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typname = 'odontogram_item_status' and typnamespace = 'public'::regnamespace
  ) then
    create type public.odontogram_item_status as enum (
      'pending',    -- patología detectada, aún sin tratar
      'budgeted',   -- presupuestado en el plan de tratamiento
      'completed',  -- realizado
      'absent'      -- pieza ausente / extraída
    );
  end if;
end
$$;

comment on type public.dentition_kind is
  'Dentición del odontograma: permanente (11-48) o temporal (51-85).';
comment on type public.tooth_surface is
  'Cara dental afectada. La ausencia de cara en un ítem significa pieza completa.';
comment on type public.odontogram_item_status is
  'Estado clínico del ítem: pendiente, presupuestado, realizado o ausente.';


-- -----------------------------------------------------------------------------
-- 2. Tablas
-- -----------------------------------------------------------------------------

-- 2.1 Mapa dental: uno por paciente y dentición.
create table if not exists public.odontograms (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,

  dentition public.dentition_kind not null default 'permanent',
  notes text,

  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint odontograms_patient_dentition_key unique (patient_id, dentition)
);

comment on table public.odontograms is
  'Odontograma del paciente: un mapa por dentición (permanente y temporal).';
comment on column public.odontograms.created_by is
  'Usuario que abrió el odontograma (odontólogo o administración).';
comment on column public.odontograms.notes is
  'Observaciones generales del mapa (oclusión, higiene, indicaciones).';


-- 2.2 Ítems del odontograma: procedimiento sobre una pieza y, opcionalmente,
--     una cara. `unit_price` congela el precio del catálogo en el momento de
--     presupuestar, igual que `patient_treatments`.
create table if not exists public.odontogram_items (
  id uuid primary key default gen_random_uuid(),
  odontogram_id uuid not null references public.odontograms (id) on delete cascade,

  tooth_number smallint not null
    check (tooth_number between 11 and 85),
  surface public.tooth_surface,
  status public.odontogram_item_status not null default 'pending',

  treatment_id uuid references public.treatments (id) on delete restrict,
  quantity integer not null default 1
    check (quantity > 0 and quantity <= 20),
  unit_price numeric(12, 2) not null default 0
    check (unit_price >= 0),
  total_price numeric(12, 2) generated always as (round(quantity * unit_price, 2)) stored,

  notes text,
  performed_at timestamptz,

  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint odontogram_items_treatment_check
    check (status = 'absent' or treatment_id is not null),
  constraint odontogram_items_absent_check
    check (status <> 'absent' or (surface is null and treatment_id is null))
);

comment on table public.odontogram_items is
  'Hallazgos y procedimientos del odontograma: pieza (FDI), cara, estado y precio en PYG.';
comment on column public.odontogram_items.tooth_number is
  'Pieza dental en notación FDI: 11-48 permanente y 51-85 temporal.';
comment on column public.odontogram_items.surface is
  'Cara afectada; NULL = pieza completa (p. ej. corona o extracción).';
comment on column public.odontogram_items.unit_price is
  'Precio unitario en guaraníes (PYG) copiado del catálogo al presupuestar.';
comment on column public.odontogram_items.total_price is
  'Columna generada: quantity * unit_price (no se inserta manualmente).';
comment on column public.odontogram_items.performed_at is
  'Fecha del tratamiento; el trigger la completa al pasar a estado completed.';


-- -----------------------------------------------------------------------------
-- 3. Validación FDI por dentición
--    La pieza no se puede validar con un CHECK simple porque depende de la
--    dentición del odontograma (tabla padre), así que se resuelve en un trigger.
-- -----------------------------------------------------------------------------
create or replace function public.validate_odontogram_item()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  chart_dentition public.dentition_kind;
  quadrant integer := new.tooth_number / 10;
  tooth_position integer := new.tooth_number % 10;
begin
  select o.dentition
  into chart_dentition
  from public.odontograms o
  where o.id = new.odontogram_id;

  if chart_dentition is null then
    raise exception 'El odontograma indicado no existe.'
      using errcode = '23503';
  end if;

  if chart_dentition = 'permanent' and (quadrant not between 1 and 4 or tooth_position not between 1 and 8) then
    raise exception 'La pieza % no pertenece a la dentición permanente (FDI 11-48).', new.tooth_number
      using errcode = '23514';
  end if;

  if chart_dentition = 'temporary' and (quadrant not between 5 and 8 or tooth_position not between 1 and 5) then
    raise exception 'La pieza % no pertenece a la dentición temporal (FDI 51-85).', new.tooth_number
      using errcode = '23514';
  end if;

  -- El estado «ausente» describe la pieza completa y sin procedimiento.
  if new.status = 'absent' then
    new.surface := null;
    new.treatment_id := null;
    new.quantity := 1;
    new.unit_price := 0;
  end if;

  -- Un ítem realizado sin fecha registrada se sella con el momento actual.
  if new.status = 'completed' then
    new.performed_at := coalesce(new.performed_at, now());
  end if;

  return new;
end;
$$;

comment on function public.validate_odontogram_item() is
  'Valida la pieza FDI contra la dentición del odontograma y normaliza los ítems ausentes/realizados.';

drop trigger if exists odontogram_items_validate on public.odontogram_items;
create trigger odontogram_items_validate
  before insert or update on public.odontogram_items
  for each row execute function public.validate_odontogram_item();


-- -----------------------------------------------------------------------------
-- 4. Índices
-- -----------------------------------------------------------------------------
create index if not exists odontograms_patient_idx
  on public.odontograms (patient_id);

create index if not exists odontogram_items_tooth_idx
  on public.odontogram_items (odontogram_id, tooth_number);

create index if not exists odontogram_items_status_idx
  on public.odontogram_items (odontogram_id, status);

create index if not exists odontogram_items_treatment_idx
  on public.odontogram_items (treatment_id)
  where treatment_id is not null;

-- Un mismo procedimiento no se repite sobre la misma pieza/cara: el servicio
-- actualiza la fila existente en lugar de duplicar el presupuesto.
create unique index if not exists odontogram_items_unique_surface_idx
  on public.odontogram_items (odontogram_id, tooth_number, surface, treatment_id)
  where status <> 'absent' and surface is not null;

create unique index if not exists odontogram_items_unique_tooth_idx
  on public.odontogram_items (odontogram_id, tooth_number, treatment_id)
  where status <> 'absent' and surface is null;

-- Una pieza solo puede marcarse como ausente una vez por odontograma.
create unique index if not exists odontogram_items_unique_absent_idx
  on public.odontogram_items (odontogram_id, tooth_number)
  where status = 'absent';


-- -----------------------------------------------------------------------------
-- 5. Mantener `updated_at`
-- -----------------------------------------------------------------------------
drop trigger if exists odontograms_set_updated_at on public.odontograms;
create trigger odontograms_set_updated_at
  before update on public.odontograms
  for each row execute function public.handle_updated_at();

drop trigger if exists odontogram_items_set_updated_at on public.odontogram_items;
create trigger odontogram_items_set_updated_at
  before update on public.odontogram_items
  for each row execute function public.handle_updated_at();


-- -----------------------------------------------------------------------------
-- 6. Autorización y Row Level Security
--    - Lectura: cualquier integrante con perfil activo (recepción necesita el
--      presupuesto para cobrar).
--    - Escritura: solo odontología y administración.
-- -----------------------------------------------------------------------------
create or replace function public.can_manage_odontograms()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.current_staff_role() in ('admin'::public.staff_role, 'dentist'::public.staff_role),
    false
  )
$$;

comment on function public.can_manage_odontograms() is
  'true cuando el usuario autenticado es admin u odontólogo activo (escribe el odontograma).';

alter table public.odontograms enable row level security;
alter table public.odontogram_items enable row level security;

drop policy if exists "odontograms_select_staff" on public.odontograms;
create policy "odontograms_select_staff"
  on public.odontograms
  for select
  to authenticated
  using (public.current_staff_role() is not null);

drop policy if exists "odontograms_write_clinical" on public.odontograms;
create policy "odontograms_write_clinical"
  on public.odontograms
  for all
  to authenticated
  using (public.can_manage_odontograms())
  with check (public.can_manage_odontograms());

drop policy if exists "odontogram_items_select_staff" on public.odontogram_items;
create policy "odontogram_items_select_staff"
  on public.odontogram_items
  for select
  to authenticated
  using (public.current_staff_role() is not null);

drop policy if exists "odontogram_items_write_clinical" on public.odontogram_items;
create policy "odontogram_items_write_clinical"
  on public.odontogram_items
  for all
  to authenticated
  using (public.can_manage_odontograms())
  with check (public.can_manage_odontograms());


-- -----------------------------------------------------------------------------
-- 7. Permisos y caché de PostgREST
-- -----------------------------------------------------------------------------
grant select, insert, update, delete
  on public.odontograms,
     public.odontogram_items
  to authenticated;

grant execute on function public.can_manage_odontograms() to authenticated;

revoke all
  on public.odontograms,
     public.odontogram_items
  from anon;

notify pgrst, 'reload schema';
