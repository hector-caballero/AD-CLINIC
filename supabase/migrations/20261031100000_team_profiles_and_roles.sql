-- =============================================================================
-- AD Clinic · Equipo del consultorio: perfiles y roles
-- -----------------------------------------------------------------------------
-- Contenido:
--   1. Enum `staff_role` (admin / dentist / receptionist)
--   2. Tabla `profiles` (1 fila por usuario de Auth) + índices
--   3. Helpers `current_staff_role()` e `is_admin()` (security definer)
--   4. Triggers:
--      - auth.users INSERT → crea el perfil (lee `full_name` y `role` de los
--        metadatos que envía la Edge Function `team-admin`)
--      - auth.users UPDATE del email → sincroniza `profiles.email`
--      - profiles → `updated_at` y protección del último administrador activo
--   5. Row Level Security: cada usuario ve su perfil; solo admin gestiona el resto
--   6. Backfill de los usuarios que ya existían al aplicar la migración
--
-- Re-ejecutable (IF NOT EXISTS / DROP ... IF EXISTS / ON CONFLICT DO NOTHING).
--
-- Bootstrap: el usuario MÁS ANTIGUO de auth.users queda como `admin` y el resto
-- como `receptionist`, para no dejar el consultorio sin administrador. Si hace
-- falta otro admin, cambialo desde /equipo o con:
--   update public.profiles set role = 'admin' where email = 'persona@clinica.com';
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Rol del personal
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'staff_role' and typnamespace = 'public'::regnamespace
  ) then
    create type public.staff_role as enum (
      'admin',        -- administración: gestiona equipo, catálogo y caja
      'dentist',      -- odontología: atiende citas y registra tratamientos
      'receptionist'  -- recepción: agenda, pacientes y cobros
    );
  end if;
end
$$;

comment on type public.staff_role is
  'Rol del personal del consultorio (columna profiles.role).';


-- -----------------------------------------------------------------------------
-- 2. Perfiles del equipo
--    El email se copia de auth.users para poder listar al equipo sin la
--    service_role key (la tabla auth.users no es accesible desde el cliente).
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  email text,
  role public.staff_role not null default 'receptionist',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_full_name_not_blank_check check (char_length(btrim(full_name)) > 0)
);

comment on table public.profiles is
  'Perfil del personal del consultorio: nombre visible, rol y estado de acceso.';
comment on column public.profiles.id is
  'Mismo id que auth.users: el perfil se borra en cascada al eliminar la cuenta.';
comment on column public.profiles.is_active is
  'false = acceso suspendido (la Edge Function team-admin bloquea el login).';

create index if not exists profiles_role_idx on public.profiles (role, is_active);
create index if not exists profiles_name_idx on public.profiles (lower(full_name));


-- -----------------------------------------------------------------------------
-- 3. Helpers de autorización
--    SECURITY DEFINER + search_path vacío: pueden leer `profiles` sin disparar
--    recursión en sus propias políticas RLS.
-- -----------------------------------------------------------------------------
create or replace function public.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active
$$;

comment on function public.current_staff_role() is
  'Rol del usuario autenticado (NULL si no tiene perfil o está suspendido).';


create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_staff_role() = 'admin'::public.staff_role, false)
$$;

comment on function public.is_admin() is
  'true cuando el usuario autenticado tiene rol admin y su perfil está activo.';


-- -----------------------------------------------------------------------------
-- 4. Triggers
-- -----------------------------------------------------------------------------

-- 4.1 Alta de usuario en Auth → perfil del equipo.
--     Los metadatos (`full_name`, `role`) los envía la Edge Function team-admin;
--     si la cuenta se crea desde el Dashboard de Supabase, cae en receptionist.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role text := nullif(btrim(new.raw_user_meta_data ->> 'role'), '');
  resolved_role public.staff_role := 'receptionist'::public.staff_role;
  resolved_name text;
begin
  if requested_role in ('admin', 'dentist', 'receptionist') then
    resolved_role := requested_role::public.staff_role;
  end if;

  resolved_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(new.email, 'equipo@adclinic.local'), '@', 1)
  );

  insert into public.profiles (id, full_name, email, role)
  values (new.id, resolved_name, new.email, resolved_role)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- 4.2 Cambio de email en Auth → se refleja en el perfil.
create or replace function public.handle_user_email_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
    set email = new.email
    where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row execute function public.handle_user_email_update();


-- 4.3 Mantener `updated_at`.
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();


-- 4.4 Nunca dejar el consultorio sin un administrador activo.
create or replace function public.protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin'
     and old.is_active
     and (new.role <> 'admin' or not new.is_active) then
    if not exists (
      select 1
      from public.profiles p
      where p.role = 'admin'
        and p.is_active
        and p.id <> old.id
    ) then
      raise exception 'La clínica necesita al menos un administrador activo.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_protect_last_admin on public.profiles;
create trigger profiles_protect_last_admin
  before update on public.profiles
  for each row execute function public.protect_last_admin();


-- -----------------------------------------------------------------------------
-- 5. Row Level Security
--    - SELECT: cada quien ve su propio perfil; admin ve todo el equipo.
--    - INSERT/UPDATE: solo admin (la Edge Function usa service_role, que salta RLS).
--    - DELETE: sin política; el perfil se borra en cascada con auth.users.
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_insert_admin" on public.profiles;
create policy "profiles_insert_admin"
  on public.profiles
  for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
  on public.profiles
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update on public.profiles to authenticated;
grant execute on function public.current_staff_role() to authenticated;
grant execute on function public.is_admin() to authenticated;

revoke all on public.profiles from anon;


-- -----------------------------------------------------------------------------
-- 6. Backfill de usuarios existentes
--    El primero (más antiguo) queda como admin; el resto, como recepción.
-- -----------------------------------------------------------------------------
insert into public.profiles (id, full_name, email, role)
select
  u.id,
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    split_part(coalesce(u.email, 'equipo@adclinic.local'), '@', 1)
  ),
  u.email,
  case
    when u.id = (
      select first_user.id
      from auth.users first_user
      order by first_user.created_at asc, first_user.id asc
      limit 1
    ) then 'admin'::public.staff_role
    else 'receptionist'::public.staff_role
  end
from auth.users u
on conflict (id) do nothing;


-- -----------------------------------------------------------------------------
-- 7. Recargar la caché de esquema de PostgREST (Supabase API)
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';

