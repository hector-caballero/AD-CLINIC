-- =============================================================================
-- AD Clinic · Facturación y gastos (Paraguay)
-- -----------------------------------------------------------------------------
-- Contenido:
--   1. Tipos (enums) del módulo fiscal
--   2. `tax_issuers`          → emisores (personas físicas o la empresa)
--   3. `clinic_tax_settings`  → modo operativo y emisor predeterminado
--   4. `invoicing_timbrados`  → timbrados autorizados y su correlativo
--   5. `invoices`             → comprobantes emitidos (IVA incluido)
--   6. `expense_invoices`     → facturas de compras / egresos
--   7. Índices
--   8. Triggers de `updated_at`
--   9. Numeración fiscal: `next_timbrado_sequence()` + `issue_invoice()`
--  10. RLS, permisos y fila única de configuración
--
-- Modelo híbrido:
--   `multi_issuer`    cada profesional emite con sus propios timbrados
--   `single_company`  la clínica emite con un RUC unificado
--
-- Convención de importes: TODOS los montos incluyen IVA (precio de venta al
-- público). El IVA se despeja con los divisores de la SET:
--   gravada 10 % → importe / 11
--   gravada 5 %  → importe / 21
--   exenta       → sin IVA
-- El guaraní no tiene centavos: los cálculos se redondean a 1 ₲ antes de
-- guardar, y `total = amount_10 + amount_5 + amount_exempt` se valida en la base.
--
-- Re-ejecutable (IF NOT EXISTS / DO $$ / create or replace).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'tax_issuer_kind' and typnamespace = 'public'::regnamespace
  ) then
    create type public.tax_issuer_kind as enum (
      'individual', -- persona física (doctor/a con RUC propio)
      'company'     -- persona jurídica (RUC unificado de la clínica)
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typname = 'invoicing_operational_mode' and typnamespace = 'public'::regnamespace
  ) then
    create type public.invoicing_operational_mode as enum (
      'multi_issuer',   -- cada doctor emite sus facturas
      'single_company'  -- una sola empresa emite por todos
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typname = 'timbrado_mode' and typnamespace = 'public'::regnamespace
  ) then
    create type public.timbrado_mode as enum (
      'manual',       -- talonario: el número se ingresa a mano
      'preprinted',   -- preimpreso: el correlativo cae desde el tope del rango
      'autoimpresor', -- impresora fiscal / sistema: correlativo automático
      'electronic'    -- factura electrónica: correlativo automático + CDC
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typname = 'invoice_status' and typnamespace = 'public'::regnamespace
  ) then
    create type public.invoice_status as enum (
      'issued',    -- emitida
      'cancelled'  -- anulada (el número queda consumido)
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typname = 'vat_rate' and typnamespace = 'public'::regnamespace
  ) then
    create type public.vat_rate as enum (
      'iva_10', -- IVA 10 % (divisor 11)
      'iva_5',  -- IVA 5 %  (divisor 21)
      'exempt'  -- operación exenta
    );
  end if;
end
$$;


-- -----------------------------------------------------------------------------
-- 2. Emisores de facturas
--    `linked_user_id` une el emisor con el profesional de `profiles`, para
--    sugerir automáticamente quién factura cuando la cita/tratamiento tiene
--    odontólogo asignado (modo `multi_issuer`).
-- -----------------------------------------------------------------------------
create table if not exists public.tax_issuers (
  id uuid primary key default gen_random_uuid(),
  kind public.tax_issuer_kind not null default 'individual',

  display_name text not null,  -- como aparece en la factura: «Dra. Ana López»
  legal_name text not null,    -- razón social / nombre y apellido completos
  ruc text not null check (ruc ~ '^[0-9]{5,8}-[0-9]$'),

  address text,
  phone text,
  email text,

  is_active boolean not null default true,
  linked_user_id uuid references auth.users (id) on delete set null,
  notes text,

  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.tax_issuers is
  'Emisores de facturas: cada doctor (persona física) o la empresa de la clínica (RUC unificado).';
comment on column public.tax_issuers.ruc is
  'RUC con dígito verificador: base de 5 a 8 dígitos, guion y DV (3870633-4, 80012345-6).';
comment on column public.tax_issuers.linked_user_id is
  'Perfil del profesional que corresponde a este emisor; se usa para sugerir el emisor de una factura.';


-- -----------------------------------------------------------------------------
-- 3. Configuración fiscal de la clínica (fila única)
--    `default_issuer_id` es el emisor que se usa sin preguntar en modo
--    `single_company` (y como preselección en `multi_issuer`).
-- -----------------------------------------------------------------------------
create table if not exists public.clinic_tax_settings (
  id smallint primary key default 1 check (id = 1),

  operational_mode public.invoicing_operational_mode not null default 'multi_issuer',
  default_issuer_id uuid references public.tax_issuers (id) on delete set null,

  legal_name text,
  ruc text,
  address text,
  phone text,
  email text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.clinic_tax_settings is
  'Configuración fiscal del consultorio: modo operativo (multi-emisor o empresa única) y emisor predeterminado.';
comment on column public.clinic_tax_settings.operational_mode is
  'multi_issuer: cada profesional emite. single_company: factura siempre el emisor predeterminado.';


-- -----------------------------------------------------------------------------
-- 4. Timbrados
--    El número completo de factura se arma con establecimiento (3), punto de
--    expedición (3) y correlativo (7): `000-000-0000000`.
--    `last_number` es el último correlativo usado (0 = todavía no se emitió).
-- -----------------------------------------------------------------------------
create table if not exists public.invoicing_timbrados (
  id uuid primary key default gen_random_uuid(),
  issuer_id uuid not null references public.tax_issuers (id) on delete cascade,

  timbrado_number text not null check (timbrado_number ~ '^[0-9]{8}$'),
  establishment text not null default '001' check (establishment ~ '^[0-9]{3}$'),
  emission_point text not null default '001' check (emission_point ~ '^[0-9]{3}$'),

  mode public.timbrado_mode not null default 'autoimpresor',
  range_from integer not null default 1 check (range_from between 1 and 9999999),
  range_to integer not null default 9999999 check (range_to between 1 and 9999999),
  last_number integer not null default 0 check (last_number between 0 and 9999999),

  valid_from date not null default current_date,
  valid_until date,
  is_active boolean not null default true,
  notes text,

  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint invoicing_timbrados_range_check check (range_to >= range_from),
  constraint invoicing_timbrados_validity_check
    check (valid_until is null or valid_until >= valid_from)
);

comment on table public.invoicing_timbrados is
  'Timbrados autorizados por emisor: rango de correlativos, vigencia y modalidad de numeración.';
comment on column public.invoicing_timbrados.last_number is
  'Último correlativo usado (0 = ninguno). En preimpresos el siguiente número es menor (caída de correlativo).';


-- -----------------------------------------------------------------------------
-- 5. Facturas emitidas
--    Guardan una copia de los datos del emisor (timbrado y número) para que el
--    comprobante no cambie si después se edita el emisor.
--    `transaction_id` enlaza la factura con el movimiento de caja que la originó.
-- -----------------------------------------------------------------------------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  issuer_id uuid not null references public.tax_issuers (id) on delete restrict,
  timbrado_id uuid references public.invoicing_timbrados (id) on delete restrict,
  patient_id uuid references public.patients (id) on delete set null,
  transaction_id uuid references public.transactions (id) on delete set null,

  -- Identificación del comprobante
  timbrado_number text not null,
  establishment text not null check (establishment ~ '^[0-9]{3}$'),
  emission_point text not null check (emission_point ~ '^[0-9]{3}$'),
  sequence_number integer not null check (sequence_number between 1 and 9999999),
  invoice_number text not null check (invoice_number ~ '^[0-9]{3}-[0-9]{3}-[0-9]{7}$'),
  mode public.timbrado_mode not null,
  cdc text check (cdc is null or cdc ~ '^[0-9]{44}$'),

  status public.invoice_status not null default 'issued',
  issued_at timestamptz not null default now(),

  -- Datos del cliente (copia al momento de emitir)
  customer_name text not null,
  customer_ruc text,
  customer_document text,
  customer_email text,
  customer_address text,

  -- Importes con IVA incluido + IVA despejado
  vat_rate public.vat_rate not null default 'iva_10',
  amount_10 numeric(12, 2) not null default 0 check (amount_10 >= 0),
  amount_5 numeric(12, 2) not null default 0 check (amount_5 >= 0),
  amount_exempt numeric(12, 2) not null default 0 check (amount_exempt >= 0),
  iva_10 numeric(12, 2) not null default 0 check (iva_10 >= 0),
  iva_5 numeric(12, 2) not null default 0 check (iva_5 >= 0),
  total numeric(12, 2) not null check (total > 0),
  currency text not null default 'PYG' check (currency ~ '^[A-Z]{3}$'),
  payment_method public.payment_method,

  notes text,
  cancelled_at timestamptz,
  cancellation_reason text,

  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint invoices_totals_check
    check (total = amount_10 + amount_5 + amount_exempt)
);

comment on table public.invoices is
  'Facturas emitidas. Los importes incluyen IVA; `iva_10`/`iva_5` guardan el IVA despejado (importe / 11 o / 21).';
comment on column public.invoices.invoice_number is
  'Número completo con máscara 000-000-0000000: establecimiento, punto de expedición y correlativo.';
comment on column public.invoices.cdc is
  'Código de Control (CDC) de 44 dígitos para factura electrónica. NULL en comprobantes impresos.';


-- -----------------------------------------------------------------------------
-- 6. Facturas de gastos (egresos)
--    `attributed_issuer_id` = NULL significa gasto general de la clínica; con
--    valor, el gasto se imputa a ese emisor (IRP/IVA personal del doctor).
-- -----------------------------------------------------------------------------
create table if not exists public.expense_invoices (
  id uuid primary key default gen_random_uuid(),

  supplier_name text not null,
  supplier_ruc text,
  timbrado_number text,
  invoice_number text not null,
  expense_kind text,

  issued_on date not null default current_date,
  description text,

  amount_10 numeric(12, 2) not null default 0 check (amount_10 >= 0),
  amount_5 numeric(12, 2) not null default 0 check (amount_5 >= 0),
  amount_exempt numeric(12, 2) not null default 0 check (amount_exempt >= 0),
  iva_10 numeric(12, 2) not null default 0 check (iva_10 >= 0),
  iva_5 numeric(12, 2) not null default 0 check (iva_5 >= 0),
  total numeric(12, 2) not null check (total > 0),
  currency text not null default 'PYG' check (currency ~ '^[A-Z]{3}$'),
  payment_method public.payment_method,

  attributed_issuer_id uuid references public.tax_issuers (id) on delete set null,
  notes text,

  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint expense_invoices_totals_check
    check (total = amount_10 + amount_5 + amount_exempt)
);

comment on table public.expense_invoices is
  'Facturas de compras y gastos del consultorio. Se imputan a la clínica (NULL) o a un emisor/doctor.';
comment on column public.expense_invoices.attributed_issuer_id is
  'Emisor al que se imputa el gasto (IRP/IVA personal). NULL = gasto general de la clínica.';


-- -----------------------------------------------------------------------------
-- 7. Índices
-- -----------------------------------------------------------------------------
-- Un mismo RUC no puede estar repetido entre emisores (se compara sin guiones).
create unique index if not exists tax_issuers_ruc_uidx
  on public.tax_issuers (replace(ruc, '-', ''));

create index if not exists tax_issuers_active_idx
  on public.tax_issuers (kind, display_name)
  where is_active;

-- Un timbrado se identifica por emisor + número + establecimiento + punto.
create unique index if not exists invoicing_timbrados_key
  on public.invoicing_timbrados (issuer_id, timbrado_number, establishment, emission_point);

create index if not exists invoicing_timbrados_issuer_idx
  on public.invoicing_timbrados (issuer_id, is_active);

-- El número fiscal no se repite nunca dentro de un mismo emisor/timbrado.
create unique index if not exists invoices_number_uidx
  on public.invoices (issuer_id, timbrado_number, establishment, emission_point, sequence_number);

create index if not exists invoices_issued_at_idx
  on public.invoices (issued_at desc);
create index if not exists invoices_issuer_idx
  on public.invoices (issuer_id, issued_at desc);
create index if not exists invoices_patient_idx
  on public.invoices (patient_id)
  where patient_id is not null;
create index if not exists invoices_timbrado_idx
  on public.invoices (timbrado_id, sequence_number);

create index if not exists expense_invoices_issued_idx
  on public.expense_invoices (issued_on desc);
create index if not exists expense_invoices_attributed_idx
  on public.expense_invoices (attributed_issuer_id)
  where attributed_issuer_id is not null;


-- -----------------------------------------------------------------------------
-- 8. Triggers de `updated_at`
-- -----------------------------------------------------------------------------
drop trigger if exists tax_issuers_set_updated_at on public.tax_issuers;
create trigger tax_issuers_set_updated_at
  before update on public.tax_issuers
  for each row execute function public.handle_updated_at();

drop trigger if exists clinic_tax_settings_set_updated_at on public.clinic_tax_settings;
create trigger clinic_tax_settings_set_updated_at
  before update on public.clinic_tax_settings
  for each row execute function public.handle_updated_at();

drop trigger if exists invoicing_timbrados_set_updated_at on public.invoicing_timbrados;
create trigger invoicing_timbrados_set_updated_at
  before update on public.invoicing_timbrados
  for each row execute function public.handle_updated_at();

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.handle_updated_at();

drop trigger if exists expense_invoices_set_updated_at on public.expense_invoices;
create trigger expense_invoices_set_updated_at
  before update on public.expense_invoices
  for each row execute function public.handle_updated_at();


-- -----------------------------------------------------------------------------
-- 9. Numeración fiscal
-- -----------------------------------------------------------------------------

-- 9.1 Próximo correlativo sugerido (solo lectura).
--     - autoimpresor / electronic: asciende desde `range_from`.
--     - preprinted: cae desde `range_to` (talonario que se usa al revés).
--     - manual: se sugiere igual que autoimpresor, pero el número es editable.
--     Devuelve NULL cuando el rango se agotó (o el timbrado no existe).
create or replace function public.next_timbrado_sequence(p_timbrado_id uuid)
returns integer
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_timbrado public.invoicing_timbrados;
  v_next integer;
begin
  select * into v_timbrado
  from public.invoicing_timbrados
  where id = p_timbrado_id;

  if not found then
    return null;
  end if;

  if v_timbrado.last_number = 0 then
    v_next := case
      when v_timbrado.mode = 'preprinted'::public.timbrado_mode then v_timbrado.range_to
      else v_timbrado.range_from
    end;
  elsif v_timbrado.mode = 'preprinted'::public.timbrado_mode then
    v_next := v_timbrado.last_number - 1;
  else
    v_next := v_timbrado.last_number + 1;
  end if;

  if v_next < v_timbrado.range_from or v_next > v_timbrado.range_to then
    return null;
  end if;

  return v_next;
end;
$$;

comment on function public.next_timbrado_sequence(uuid) is
  'Correlativo sugerido del timbrado (asciende o cae según la modalidad). NULL si el rango se agotó.';


-- 9.2 Emisión atómica.
--     Bloquea el timbrado (`for update`), resuelve el correlativo, valida rango
--     y duplicados, inserta la factura y actualiza `last_number` en la misma
--     transacción. Si la factura no se puede insertar, el número no se consume.
--
--     `p_invoice` (jsonb) admite:
--       sequence_number, customer_name, customer_ruc, customer_document,
--       customer_email, customer_address, vat_rate, amount_10, amount_5,
--       amount_exempt, iva_10, iva_5, payment_method, patient_id,
--       transaction_id, cdc, notes, issued_at, currency.
create or replace function public.issue_invoice(p_timbrado_id uuid, p_invoice jsonb)
returns public.invoices
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_timbrado public.invoicing_timbrados;
  v_row public.invoices;
  v_sequence integer;
  v_customer_name text;
  v_amount_10 numeric;
  v_amount_5 numeric;
  v_amount_exempt numeric;
  v_iva_10 numeric;
  v_iva_5 numeric;
  v_total numeric;
  v_issued_at timestamptz;
begin
  select * into v_timbrado
  from public.invoicing_timbrados
  where id = p_timbrado_id
  for update;

  if not found then
    raise exception 'El timbrado seleccionado no existe o fue eliminado.';
  end if;

  if not v_timbrado.is_active then
    raise exception 'El timbrado % está inactivo. Elegí otro timbrado.', v_timbrado.timbrado_number;
  end if;

  if v_timbrado.valid_until is not null and v_timbrado.valid_until < current_date then
    raise exception 'El timbrado % venció el %. Actualizá el timbrado antes de facturar.',
      v_timbrado.timbrado_number, to_char(v_timbrado.valid_until, 'DD/MM/YYYY');
  end if;

  v_sequence := nullif(btrim(coalesce(p_invoice ->> 'sequence_number', '')), '')::integer;

  if v_sequence is null then
    if v_timbrado.mode = 'preprinted'::public.timbrado_mode then
      v_sequence := case
        when v_timbrado.last_number = 0 then v_timbrado.range_to
        else v_timbrado.last_number - 1
      end;
    else
      v_sequence := case
        when v_timbrado.last_number < v_timbrado.range_from then v_timbrado.range_from
        else v_timbrado.last_number + 1
      end;
    end if;
  end if;

  if v_sequence < v_timbrado.range_from or v_sequence > v_timbrado.range_to then
    raise exception 'El número % está fuera del rango autorizado del timbrado % (% al %).',
      lpad(v_sequence::text, 7, '0'),
      v_timbrado.timbrado_number,
      lpad(v_timbrado.range_from::text, 7, '0'),
      lpad(v_timbrado.range_to::text, 7, '0');
  end if;

  if exists (
    select 1
    from public.invoices i
    where i.issuer_id = v_timbrado.issuer_id
      and i.timbrado_number = v_timbrado.timbrado_number
      and i.establishment = v_timbrado.establishment
      and i.emission_point = v_timbrado.emission_point
      and i.sequence_number = v_sequence
  ) then
    raise exception 'El número % ya fue usado en el timbrado %.',
      lpad(v_sequence::text, 7, '0'), v_timbrado.timbrado_number;
  end if;

  v_customer_name := nullif(btrim(coalesce(p_invoice ->> 'customer_name', '')), '');

  if v_customer_name is null then
    raise exception 'La factura necesita el nombre del cliente.';
  end if;

  v_amount_10 := round(coalesce((p_invoice ->> 'amount_10')::numeric, 0), 0);
  v_amount_5 := round(coalesce((p_invoice ->> 'amount_5')::numeric, 0), 0);
  v_amount_exempt := round(coalesce((p_invoice ->> 'amount_exempt')::numeric, 0), 0);
  v_iva_10 := round(coalesce((p_invoice ->> 'iva_10')::numeric, 0), 0);
  v_iva_5 := round(coalesce((p_invoice ->> 'iva_5')::numeric, 0), 0);
  v_total := v_amount_10 + v_amount_5 + v_amount_exempt;

  if v_total <= 0 then
    raise exception 'El total de la factura debe ser mayor a cero.';
  end if;

  v_issued_at := coalesce(
    nullif(btrim(coalesce(p_invoice ->> 'issued_at', '')), '')::timestamptz,
    now()
  );

  insert into public.invoices (
    issuer_id, timbrado_id, patient_id, transaction_id,
    timbrado_number, establishment, emission_point, sequence_number,
    invoice_number, mode, cdc, status, issued_at,
    customer_name, customer_ruc, customer_document, customer_email, customer_address,
    vat_rate, amount_10, amount_5, amount_exempt, iva_10, iva_5, total,
    currency, payment_method, notes, created_by
  )
  values (
    v_timbrado.issuer_id,
    v_timbrado.id,
    nullif(btrim(coalesce(p_invoice ->> 'patient_id', '')), '')::uuid,
    nullif(btrim(coalesce(p_invoice ->> 'transaction_id', '')), '')::uuid,
    v_timbrado.timbrado_number,
    v_timbrado.establishment,
    v_timbrado.emission_point,
    v_sequence,
    format(
      '%s-%s-%s',
      v_timbrado.establishment,
      v_timbrado.emission_point,
      lpad(v_sequence::text, 7, '0')
    ),
    v_timbrado.mode,
    nullif(btrim(coalesce(p_invoice ->> 'cdc', '')), ''),
    'issued'::public.invoice_status,
    v_issued_at,
    v_customer_name,
    nullif(btrim(coalesce(p_invoice ->> 'customer_ruc', '')), ''),
    nullif(btrim(coalesce(p_invoice ->> 'customer_document', '')), ''),
    nullif(btrim(coalesce(p_invoice ->> 'customer_email', '')), ''),
    nullif(btrim(coalesce(p_invoice ->> 'customer_address', '')), ''),
    coalesce(nullif(p_invoice ->> 'vat_rate', ''), 'iva_10')::public.vat_rate,
    v_amount_10,
    v_amount_5,
    v_amount_exempt,
    v_iva_10,
    v_iva_5,
    v_total,
    coalesce(nullif(p_invoice ->> 'currency', ''), 'PYG'),
    nullif(p_invoice ->> 'payment_method', '')::public.payment_method,
    nullif(btrim(coalesce(p_invoice ->> 'notes', '')), ''),
    auth.uid()
  )
  returning * into v_row;

  -- El correlativo avanza (o cae, en preimpresos) sin retroceder nunca.
  update public.invoicing_timbrados t
  set last_number = case
    when t.mode = 'preprinted'::public.timbrado_mode
      then least(coalesce(nullif(t.last_number, 0), v_sequence), v_sequence)
    else greatest(t.last_number, v_sequence)
  end
  where t.id = v_timbrado.id;

  return v_row;
end;
$$;

comment on function public.issue_invoice(uuid, jsonb) is
  'Emite una factura de forma atómica: valida el timbrado, resuelve el correlativo y actualiza last_number.';


-- -----------------------------------------------------------------------------
-- 10. RLS, permisos y configuración inicial
--     Mismo criterio que el resto del esquema: cualquier usuario autenticado
--     gestiona los datos fiscales; `anon` no accede a nada.
-- -----------------------------------------------------------------------------
alter table public.tax_issuers enable row level security;
alter table public.clinic_tax_settings enable row level security;
alter table public.invoicing_timbrados enable row level security;
alter table public.invoices enable row level security;
alter table public.expense_invoices enable row level security;

drop policy if exists "tax_issuers_manage_authenticated" on public.tax_issuers;
create policy "tax_issuers_manage_authenticated"
  on public.tax_issuers
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "clinic_tax_settings_manage_authenticated" on public.clinic_tax_settings;
create policy "clinic_tax_settings_manage_authenticated"
  on public.clinic_tax_settings
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "invoicing_timbrados_manage_authenticated" on public.invoicing_timbrados;
create policy "invoicing_timbrados_manage_authenticated"
  on public.invoicing_timbrados
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "invoices_manage_authenticated" on public.invoices;
create policy "invoices_manage_authenticated"
  on public.invoices
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "expense_invoices_manage_authenticated" on public.expense_invoices;
create policy "expense_invoices_manage_authenticated"
  on public.expense_invoices
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.tax_issuers,
     public.clinic_tax_settings,
     public.invoicing_timbrados,
     public.invoices,
     public.expense_invoices
  to authenticated;

-- Las funciones nacen con EXECUTE para PUBLIC: se cierra y se abre solo al
-- personal autenticado.
revoke all on function public.next_timbrado_sequence(uuid) from public, anon;
revoke all on function public.issue_invoice(uuid, jsonb) from public, anon;

grant execute on function public.next_timbrado_sequence(uuid) to authenticated;
grant execute on function public.issue_invoice(uuid, jsonb) to authenticated;

revoke all
  on public.tax_issuers,
     public.clinic_tax_settings,
     public.invoicing_timbrados,
     public.invoices,
     public.expense_invoices
  from anon;

-- Fila única de configuración (la clínica empieza en modo multi-emisor).
insert into public.clinic_tax_settings (id) values (1)
on conflict (id) do nothing;


-- -----------------------------------------------------------------------------
-- 11. Caché de PostgREST
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';
