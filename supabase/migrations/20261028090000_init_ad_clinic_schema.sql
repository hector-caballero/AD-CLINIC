-- =============================================================================
-- AD Clinic · Esquema inicial para Supabase (PostgreSQL)
-- -----------------------------------------------------------------------------
-- Contenido:
--   1. Tipos (enums)
--   2. Función genérica de `updated_at`
--   3. Tablas: patients, treatments, appointments, patient_treatments, transactions
--   4. Índices
--   5. Triggers
--   6. Vista de saldos por paciente
--   7. Row Level Security (RLS) + políticas para usuarios autenticados
--   8. Datos semilla del catálogo de tratamientos
--
-- El script es re-ejecutable (IF NOT EXISTS / DROP POLICY IF EXISTS).
-- Al final se recarga el esquema de PostgREST para que la API vea los cambios.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'appointment_status' and typnamespace = 'public'::regnamespace
  ) then
    create type public.appointment_status as enum (
      'scheduled',   -- agendada
      'confirmed',   -- confirmada por el paciente
      'checked_in',  -- paciente presente en recepción
      'completed',   -- atendida
      'cancelled',   -- cancelada
      'no_show'      -- el paciente no asistió
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typname = 'treatment_status' and typnamespace = 'public'::regnamespace
  ) then
    create type public.treatment_status as enum (
      'planned',      -- presupuestado / planificado
      'in_progress',  -- en curso
      'completed',    -- realizado
      'cancelled'     -- anulado
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typname = 'transaction_type' and typnamespace = 'public'::regnamespace
  ) then
    create type public.transaction_type as enum (
      'charge',      -- cargo al paciente (incrementa la deuda)
      'payment',     -- pago recibido (reduce la deuda)
      'refund',      -- devolución al paciente (reduce lo pagado)
      'adjustment'   -- descuento o ajuste (reduce la deuda)
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typname = 'transaction_status' and typnamespace = 'public'::regnamespace
  ) then
    create type public.transaction_status as enum (
      'pending',        -- pendiente de cobro / confirmación
      'paid',           -- pagado
      'partially_paid', -- pago parcial
      'refunded',       -- devuelto
      'cancelled'       -- anulado
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typname = 'payment_method' and typnamespace = 'public'::regnamespace
  ) then
    create type public.payment_method as enum (
      'cash',
      'card',
      'transfer',
      'insurance',
      'other'
    );
  end if;
end
$$;


-- -----------------------------------------------------------------------------
-- 2. Función genérica para mantener `updated_at`
-- -----------------------------------------------------------------------------
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.handle_updated_at() is
  'Actualiza updated_at en cada UPDATE. Se reutiliza en todas las tablas de negocio.';


-- -----------------------------------------------------------------------------
-- 3. Tablas
-- -----------------------------------------------------------------------------

-- 3.1 Pacientes: datos personales, contacto e historia clínica
create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),

  -- Datos personales
  first_name text not null,
  last_name text not null,
  document_type text not null default 'DNI',
  document_number text,
  birth_date date,
  gender text check (gender in ('female', 'male', 'other', 'prefer_not_to_say')),
  occupation text,

  -- Contacto
  phone text not null,
  phone_alt text,
  email text,
  address text,
  city text,
  postal_code text,
  emergency_contact_name text,
  emergency_contact_phone text,

  -- Cobertura médica
  insurance_provider text,
  insurance_policy_number text,

  -- Historia clínica
  blood_type text not null default 'unknown'
    check (blood_type in ('O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'unknown')),
  allergies text[] not null default '{}',
  medical_conditions text[] not null default '{}',
  current_medications text[] not null default '{}',
  is_smoker boolean not null default false,
  is_pregnant boolean not null default false,
  medical_notes text,

  -- Operación
  status text not null default 'active'
    check (status in ('active', 'inactive', 'archived')),
  notes text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint patients_email_format_check
    check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint patients_phone_format_check
    check (char_length(btrim(phone)) >= 6),
  constraint patients_names_not_blank_check
    check (char_length(btrim(first_name)) > 0 and char_length(btrim(last_name)) > 0),
  constraint patients_birth_date_check
    check (birth_date is null or birth_date > date '1900-01-01')
);

comment on table public.patients is
  'Pacientes de la clínica: datos personales, contacto, cobertura e historia clínica.';
comment on column public.patients.deleted_at is
  'Borrado lógico: nunca se elimina la historia clínica de un paciente.';
comment on column public.patients.allergies is
  'Lista libre de alergias conocidas (p. ej. penicilina, látex, anestésicos).';
comment on column public.patients.medical_conditions is
  'Antecedentes relevantes (diabetes, hipertensión, anticoagulantes, etc.).';


-- 3.2 Catálogo de tratamientos dentales
create table if not exists public.treatments (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  category text not null default 'general',
  description text,
  default_price numeric(12, 2) not null default 0
    check (default_price >= 0),
  default_duration_minutes integer not null default 30
    check (default_duration_minutes between 5 and 600),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint treatments_code_key unique (code),
  constraint treatments_name_not_blank_check check (char_length(btrim(name)) > 0)
);

comment on table public.treatments is
  'Catálogo de tratamientos dentales y su precio/duración por defecto.';
comment on column public.treatments.code is
  'Código interno o nomenclatura clínica (ADA/CDT). Debe ser único.';


-- 3.3 Citas
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  dentist_id uuid references auth.users (id) on delete set null,

  starts_at timestamptz not null,
  ends_at timestamptz not null,

  status public.appointment_status not null default 'scheduled',
  reason text not null,
  notes text,
  cancellation_reason text,

  checked_in_at timestamptz,
  completed_at timestamptz,
  reminder_sent_at timestamptz,

  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint appointments_time_range_check check (ends_at > starts_at),
  constraint appointments_max_duration_check
    check (ends_at - starts_at <= interval '8 hours'),
  constraint appointments_reason_not_blank_check check (char_length(btrim(reason)) > 0),
  constraint appointments_cancellation_reason_check
    check (status <> 'cancelled' or cancellation_reason is not null)
);

comment on table public.appointments is
  'Agenda de citas: fecha/hora, estado y motivo de la consulta.';
comment on column public.appointments.dentist_id is
  'Usuario (auth.users) que atiende la cita: odontólogo responsable.';

-- Protección opcional contra doble reserva del mismo odontólogo.
-- Requiere la extensión btree_gist: create extension if not exists btree_gist;
-- alter table public.appointments
--   add constraint appointments_no_overlap
--   exclude using gist (
--     dentist_id with =,
--     tstzrange(starts_at, ends_at) with &&
--   ) where (status in ('scheduled', 'confirmed', 'checked_in'));


-- 3.4 Tratamientos realizados / planificados por paciente
create table if not exists public.patient_treatments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete cascade,
  treatment_id uuid references public.treatments (id) on delete restrict,
  appointment_id uuid references public.appointments (id) on delete set null,
  dentist_id uuid references auth.users (id) on delete set null,

  status public.treatment_status not null default 'planned',
  tooth_numbers text[] not null default '{}',
  surface text,
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  total_price numeric(12, 2) generated always as (round(quantity * unit_price, 2)) stored,

  performed_at timestamptz,
  clinical_notes text,

  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.patient_treatments is
  'Detalle clínico de cada tratamiento aplicado o presupuestado a un paciente.';
comment on column public.patient_treatments.tooth_numbers is
  'Piezas dentales afectadas en notación FDI (p. ej. {16,17}) o vacío para tratamientos generales.';
comment on column public.patient_treatments.total_price is
  'Columna generada: quantity * unit_price (no se inserta manualmente).';


-- 3.5 Transacciones de cobro y pagos
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients (id) on delete restrict,
  appointment_id uuid references public.appointments (id) on delete set null,
  patient_treatment_id uuid references public.patient_treatments (id) on delete set null,

  type public.transaction_type not null,
  status public.transaction_status not null default 'pending',
  method public.payment_method,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),

  due_date date,
  paid_at timestamptz,
  receipt_number text,
  reference text,
  notes text,

  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint transactions_method_check
    check (type in ('payment', 'refund') or method is null),
  constraint transactions_due_date_check
    check (due_date is null or type = 'charge')
);

comment on table public.transactions is
  'Cuenta corriente del paciente: cargos, pagos, devoluciones y ajustes.';
comment on column public.transactions.amount is
  'Importe siempre positivo; el signo contable lo determina `type`.';
comment on column public.transactions.receipt_number is
  'Número de recibo/comprobante entregado al paciente.';


-- -----------------------------------------------------------------------------
-- 4. Índices
-- -----------------------------------------------------------------------------
create unique index if not exists patients_document_number_uidx
  on public.patients (upper(btrim(document_number)))
  where document_number is not null;

create index if not exists patients_name_idx
  on public.patients (lower(last_name), lower(first_name));
create index if not exists patients_phone_idx
  on public.patients (phone);
create index if not exists patients_active_idx
  on public.patients (status)
  where deleted_at is null;

create index if not exists appointments_starts_at_idx
  on public.appointments (starts_at desc);
create index if not exists appointments_patient_idx
  on public.appointments (patient_id, starts_at desc);
create index if not exists appointments_dentist_idx
  on public.appointments (dentist_id, starts_at desc);
create index if not exists appointments_active_idx
  on public.appointments (starts_at)
  where status in ('scheduled', 'confirmed', 'checked_in');

create index if not exists treatments_category_idx
  on public.treatments (category)
  where is_active;

create index if not exists patient_treatments_patient_idx
  on public.patient_treatments (patient_id, performed_at desc);
create index if not exists patient_treatments_treatment_idx
  on public.patient_treatments (treatment_id);
create index if not exists patient_treatments_appointment_idx
  on public.patient_treatments (appointment_id);
create index if not exists patient_treatments_status_idx
  on public.patient_treatments (status);

create index if not exists transactions_patient_idx
  on public.transactions (patient_id, created_at desc);
create index if not exists transactions_pending_idx
  on public.transactions (status, due_date)
  where type = 'charge' and status in ('pending', 'partially_paid');
create index if not exists transactions_appointment_idx
  on public.transactions (appointment_id);

create unique index if not exists transactions_receipt_number_uidx
  on public.transactions (receipt_number)
  where receipt_number is not null;


-- -----------------------------------------------------------------------------
-- 5. Triggers
-- -----------------------------------------------------------------------------
drop trigger if exists patients_set_updated_at on public.patients;
create trigger patients_set_updated_at
  before update on public.patients
  for each row execute function public.handle_updated_at();

drop trigger if exists treatments_set_updated_at on public.treatments;
create trigger treatments_set_updated_at
  before update on public.treatments
  for each row execute function public.handle_updated_at();

drop trigger if exists appointments_set_updated_at on public.appointments;
create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.handle_updated_at();

drop trigger if exists patient_treatments_set_updated_at on public.patient_treatments;
create trigger patient_treatments_set_updated_at
  before update on public.patient_treatments
  for each row execute function public.handle_updated_at();

drop trigger if exists transactions_set_updated_at on public.transactions;
create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.handle_updated_at();

-- Sella la fecha de pago automáticamente al marcar una transacción como pagada.
create or replace function public.handle_transaction_paid_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'paid' then
    new.paid_at := coalesce(new.paid_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists transactions_set_paid_at on public.transactions;
create trigger transactions_set_paid_at
  before insert or update on public.transactions
  for each row execute function public.handle_transaction_paid_at();


-- -----------------------------------------------------------------------------
-- 6. Vista de saldos por paciente
--    security_invoker = true para que se aplique el RLS de las tablas base.
--    balance = cargos - ajustes - pagos + devoluciones
-- -----------------------------------------------------------------------------
create or replace view public.patient_balances
with (security_invoker = true) as
select
  p.id as patient_id,
  p.first_name,
  p.last_name,
  p.phone,
  coalesce(l.total_charges, 0)::numeric(12, 2) as total_charges,
  coalesce(l.total_adjustments, 0)::numeric(12, 2) as total_adjustments,
  coalesce(l.total_payments, 0)::numeric(12, 2) as total_payments,
  coalesce(l.total_refunds, 0)::numeric(12, 2) as total_refunds,
  (
    coalesce(l.total_charges, 0)
    - coalesce(l.total_adjustments, 0)
    - coalesce(l.total_payments, 0)
    + coalesce(l.total_refunds, 0)
  )::numeric(12, 2) as balance,
  l.last_payment_at
from public.patients p
left join (
  select
    t.patient_id,
    sum(t.amount) filter (where t.type = 'charge' and t.status <> 'cancelled') as total_charges,
    sum(t.amount) filter (where t.type = 'adjustment' and t.status <> 'cancelled') as total_adjustments,
    sum(t.amount) filter (where t.type = 'payment' and t.status = 'paid') as total_payments,
    sum(t.amount) filter (where t.type = 'refund' and t.status <> 'cancelled') as total_refunds,
    max(t.paid_at) filter (where t.type = 'payment') as last_payment_at
  from public.transactions t
  group by t.patient_id
) l on l.patient_id = p.id
where p.deleted_at is null;

comment on view public.patient_balances is
  'Saldo por paciente: cargos - ajustes - pagos (confirmados) + devoluciones.';


-- -----------------------------------------------------------------------------
-- 7. Row Level Security
--    Política base: CUALQUIER usuario autenticado puede gestionar todo.
--    Requisito: el usuario debe existir en auth.users y tener sesión activa.
--    Los usuarios anónimos (rol `anon`) no acceden a ninguna tabla.
-- -----------------------------------------------------------------------------
alter table public.patients enable row level security;
alter table public.treatments enable row level security;
alter table public.appointments enable row level security;
alter table public.patient_treatments enable row level security;
alter table public.transactions enable row level security;

-- Pacientes
drop policy if exists "patients_manage_authenticated" on public.patients;
create policy "patients_manage_authenticated"
  on public.patients
  for all
  to authenticated
  using (true)
  with check (true);

-- Catálogo de tratamientos
drop policy if exists "treatments_manage_authenticated" on public.treatments;
create policy "treatments_manage_authenticated"
  on public.treatments
  for all
  to authenticated
  using (true)
  with check (true);

-- Citas
drop policy if exists "appointments_manage_authenticated" on public.appointments;
create policy "appointments_manage_authenticated"
  on public.appointments
  for all
  to authenticated
  using (true)
  with check (true);

-- Tratamientos por paciente
drop policy if exists "patient_treatments_manage_authenticated" on public.patient_treatments;
create policy "patient_treatments_manage_authenticated"
  on public.patient_treatments
  for all
  to authenticated
  using (true)
  with check (true);

-- Transacciones / cobros
drop policy if exists "transactions_manage_authenticated" on public.transactions;
create policy "transactions_manage_authenticated"
  on public.transactions
  for all
  to authenticated
  using (true)
  with check (true);

-- Permisos explícitos por rol (el RLS sigue siendo la única barrera real)
grant usage on schema public to authenticated;

grant select, insert, update, delete
  on public.patients,
     public.treatments,
     public.appointments,
     public.patient_treatments,
     public.transactions
  to authenticated;

grant select on public.patient_balances to authenticated;

revoke all
  on public.patients,
     public.treatments,
     public.appointments,
     public.patient_treatments,
     public.transactions,
     public.patient_balances
  from anon;


-- -----------------------------------------------------------------------------
-- 8. Datos semilla del catálogo de tratamientos (idempotente)
-- -----------------------------------------------------------------------------
insert into public.treatments (code, name, category, description, default_price, default_duration_minutes)
values
  ('PRO-001', 'Profilaxis (limpieza dental)', 'prevención',       'Remoción de placa y cálculo supragingival.',            45.00,  40),
  ('PRO-002', 'Aplicación tópica de flúor',   'prevención',       'Fluorización profesional en gel o barniz.',             25.00,  20),
  ('PRO-003', 'Sellado de fosetas y fisuras','prevención',       'Sellador preventivo en molares sanos.',                 30.00,  30),
  ('OPE-001', 'Obturación con resina',        'operatoria',       'Restauración estética de una superficie.',               65.00,  45),
  ('OPE-002', 'Reconstrucción coronaria',     'operatoria',       'Reconstrucción de pieza con pérdida severa de estructura.', 120.00, 60),
  ('END-001', 'Endodoncia unirradicular',     'endodoncia',       'Tratamiento de conducto en pieza con una raíz.',        250.00,  90),
  ('END-002', 'Endodoncia multirradicular',   'endodoncia',       'Tratamiento de conducto en pieza con varias raíces.',   380.00, 120),
  ('PER-001', 'Destartraje y alisado radicular', 'periodoncia',   'Instrumentación subgingival por cuadrante.',             90.00,  60),
  ('CIR-001', 'Extracción simple',            'cirugía',          'Exodoncia de pieza erupcionada.',                        80.00,  30),
  ('CIR-002', 'Extracción quirúrgica',        'cirugía',          'Exodoncia de tercer molar o pieza impactada.',          220.00,  60),
  ('PRO-004', 'Corona de porcelana',          'prótesis',         'Corona fija metal-cerámica o de circonio.',             450.00,  90),
  ('PRO-005', 'Prótesis parcial removible',   'prótesis',         'Prótesis removible con base acrílica y ganchos.',       600.00,  90),
  ('ORT-001', 'Control de ortodoncia',        'ortodoncia',       'Ajuste mensual del aparato y cambio de arcos.',          70.00,  30),
  ('EST-001', 'Blanqueamiento dental',        'estética',         'Blanqueamiento en consultorio con activación.',         300.00,  90),
  ('IMG-001', 'Radiografía periapical',       'imagen',           'Radiografía intraoral de pieza única.',                  15.00,  10),
  ('IMG-002', 'Radiografía panorámica',       'imagen',           'Ortopantomografía de arcadas completas.',                40.00,  15)
on conflict (code) do nothing;


-- -----------------------------------------------------------------------------
-- 9. Recargar la caché de esquema de PostgREST (Supabase API)
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';
