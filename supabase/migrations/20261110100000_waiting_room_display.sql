-- =============================================================================
-- AD Clinic · Pantalla de sala de espera (modo TV / turnero)
-- -----------------------------------------------------------------------------
-- Contenido:
--   1. Columnas de llamada en `appointments` (`room`, `called_at`, `called_by`)
--   2. Índice parcial de los pacientes en sala
--   3. Realtime: `appointments` entra en la publicación `supabase_realtime`
--   4. Vista `staff_directory`: nombre y rol del equipo para el turnero y el
--      selector de profesional de la agenda
--
-- La pantalla de sala (`/tv`) se sincroniza por Realtime y NO inventa estados:
-- los tres conceptos del turnero se derivan de lo que ya existe en la agenda.
--
--   waiting      → status = 'checked_in' y `called_at` vacío (está en sala)
--   calling      → status = 'checked_in' y `called_at` reciente (llamado)
--   in_progress  → status = 'checked_in' y `called_at` viejo (ya pasó)
--   attended     → status = 'completed' (últimos atendidos del día)
--
-- `called_at` es la marca de la última llamada: el botón «Llamar a sala» de la
-- agenda la escribe (junto con `checked_in` si el paciente todavía no había
-- llegado) y la tele reacciona al instante.
--
-- Re-ejecutable (IF NOT EXISTS / DO $$ / create or replace view).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Columnas de llamada
-- -----------------------------------------------------------------------------
alter table public.appointments
  add column if not exists room text,
  add column if not exists called_at timestamptz,
  add column if not exists called_by uuid default auth.uid()
    references auth.users (id) on delete set null;

comment on column public.appointments.room is
  'Consultorio / box donde se atiende la cita (texto libre: «Box 1», «Consultorio 2»).';
comment on column public.appointments.called_at is
  'Última llamada a sala. La escribe «Llamar a sala» en la agenda y la pantalla /tv la usa para el aviso.';
comment on column public.appointments.called_by is
  'Usuario que hizo la última llamada (auditoría del turnero).';

-- El largo se valida también en el cliente; acá se corta el abuso desde la API.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appointments_room_length_check'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_room_length_check
      check (room is null or (char_length(btrim(room)) > 0 and char_length(room) <= 40));
  end if;
end
$$;


-- -----------------------------------------------------------------------------
-- 2. Índice de la cola de sala
--    La tele pide el día completo; el índice parcial deja el barrido en las
--    pocas filas que están efectivamente en sala.
-- -----------------------------------------------------------------------------
create index if not exists appointments_checked_in_idx
  on public.appointments (starts_at)
  where status = 'checked_in';


-- -----------------------------------------------------------------------------
-- 3. Realtime
--    Sin esta publicación el canal `public:appointments` se suscribe pero nunca
--    recibe eventos (y la tele solo se actualizaría con el refresco de respaldo).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'appointments'
    )
  then
    alter publication supabase_realtime add table public.appointments;
  end if;
end
$$;

-- `full` hace que los payloads de UPDATE/DELETE traigan la fila completa: la
-- tele necesita el id y la fecha para decidir si el cambio le afecta.
alter table public.appointments replica identity full;


-- -----------------------------------------------------------------------------
-- 4. Directorio del equipo
--    `profiles` solo es legible por su dueño o por administración (RLS). El
--    turnero y el selector de profesional necesitan el nombre de todo el
--    personal activo, pero no el email ni el estado de acceso: esta vista
--    expone únicamente `id`, `full_name` y `role`.
--
--    Se crea como vista del dueño (`security_invoker = false`, el valor por
--    defecto) a propósito: corre con los permisos de `postgres` y por eso puede
--    leer perfiles ajenos. Al no incluir columnas sensibles, exponerla a
--    `authenticated` es seguro; `anon` queda sin acceso.
-- -----------------------------------------------------------------------------
create or replace view public.staff_directory
with (security_invoker = false)
as
select
  p.id,
  p.full_name,
  p.role
from public.profiles p
where p.is_active;

comment on view public.staff_directory is
  'Directorio del personal activo (id, nombre y rol) para asignar profesional a una cita y mostrar el turnero. Excluye email y cualquier dato de acceso.';

-- Los privilegios por defecto de Supabase darían DML sobre la vista (es
-- auto-actualizable al salir de una sola tabla), así que se deja solo lectura:
-- el directorio se consulta, nunca se escribe desde la vista.
revoke all on public.staff_directory from anon, authenticated;
grant select on public.staff_directory to authenticated;


-- -----------------------------------------------------------------------------
-- 5. Recargar la caché de esquema de PostgREST (columnas + vista nuevas)
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';
