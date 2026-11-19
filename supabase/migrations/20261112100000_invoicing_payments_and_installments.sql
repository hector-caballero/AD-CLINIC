-- -----------------------------------------------------------------------------
-- Cobros, abonos y facturas en cuotas
--
-- Puente entre tres módulos que hasta ahora vivían separados:
--   * Facturación  → una factura ya no es "todo o nada" cobrado.
--   * Caja         → un cobro (`transactions.type = 'payment'`) puede quedar
--                    pendiente de facturar o facturado por partes.
--   * Presupuestos → el anticipo cobrado antes de facturar se convierte en un
--                    cobro de caja y luego se aplica a la factura.
--
-- Piezas nuevas:
--   invoices.condition / installments_count / paid_amount / payment_status
--   invoices.balance                         (columna generada: total - pagos)
--   invoice_payment_allocations              (cobro de caja ↔ factura)
--   invoice_installments                     (plan de cuotas y su estado)
--   transaction_invoicing (vista)            (facturado / disponible por cobro)
--   issue_invoice / register_invoice_payment / plan_invoice_installments
--
-- Re-ejecutable: IF NOT EXISTS / DO $$ / create or replace.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- 1. Enumeraciones
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'invoice_condition' and typnamespace = 'public'::regnamespace
  ) then
    create type public.invoice_condition as enum (
      'contado',  -- se cobra al emitir
      'credito'   -- se cobra en cuotas / a plazo
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typname = 'invoice_payment_status' and typnamespace = 'public'::regnamespace
  ) then
    create type public.invoice_payment_status as enum (
      'unpaid',   -- sin cobros aplicados
      'partial',  -- abono parcial: queda saldo
      'paid'      -- saldada
    );
  end if;

  if not exists (
    select 1 from pg_type
    where typname = 'invoice_installment_status' and typnamespace = 'public'::regnamespace
  ) then
    create type public.invoice_installment_status as enum (
      'pending',  -- todavía no venció y no tiene cobros
      'partial',  -- tiene abonos, pero queda saldo
      'paid',     -- cubierta
      'overdue'   -- venció con saldo pendiente
    );
  end if;
end
$$;


-- -----------------------------------------------------------------------------
-- 2. Columnas nuevas en `invoices`
-- -----------------------------------------------------------------------------
alter table public.invoices
  add column if not exists condition public.invoice_condition not null default 'contado',
  add column if not exists installments_count integer not null default 1,
  add column if not exists paid_amount numeric(12, 2) not null default 0,
  add column if not exists payment_status public.invoice_payment_status not null default 'unpaid';

-- `balance` se calcula sola: nunca puede quedar desincronizada de `total`.
alter table public.invoices
  add column if not exists balance numeric(12, 2)
    generated always as (total - paid_amount) stored;

alter table public.invoices
  drop constraint if exists invoices_installments_count_check;
alter table public.invoices
  add constraint invoices_installments_count_check
    check (installments_count between 1 and 60);

alter table public.invoices
  drop constraint if exists invoices_paid_amount_check;
alter table public.invoices
  add constraint invoices_paid_amount_check
    check (paid_amount >= 0);

comment on column public.invoices.condition is
  'Contado (se cobra al emitir) o crédito (cuotas / plazo).';
comment on column public.invoices.installments_count is
  'Cantidad de cuotas del plan; 1 equivale a pago único.';
comment on column public.invoices.paid_amount is
  'Suma de los cobros aplicados. Lo mantiene `recalc_invoice_payment`.';
comment on column public.invoices.balance is
  'Saldo pendiente (total - paid_amount). Columna generada.';
comment on column public.invoices.payment_status is
  'unpaid / partial / paid según los cobros aplicados.';


-- -----------------------------------------------------------------------------
-- 3. Aplicación de cobros de caja a facturas
--    Un movimiento de caja puede cubrir varias facturas y una factura puede
--    cobrarse con varios movimientos (abonos). La suma por movimiento nunca
--    puede superar el importe del cobro.
-- -----------------------------------------------------------------------------
create table if not exists public.invoice_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  installment_id uuid,
  transaction_id uuid not null references public.transactions (id) on delete restrict,

  amount numeric(12, 2) not null check (amount > 0),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.invoice_payment_allocations is
  'Qué parte de cada cobro de caja paga cada factura (y opcionalmente qué cuota).';
comment on column public.invoice_payment_allocations.transaction_id is
  'Movimiento de `transactions`; por convención un `payment` ya cobrado.';

create index if not exists invoice_payment_allocations_invoice_idx
  on public.invoice_payment_allocations (invoice_id);
create index if not exists invoice_payment_allocations_transaction_idx
  on public.invoice_payment_allocations (transaction_id);
create index if not exists invoice_payment_allocations_installment_idx
  on public.invoice_payment_allocations (installment_id)
  where installment_id is not null;

-- Un mismo cobro no puede aplicarse dos veces a la misma factura ni a la misma
-- cuota: el reintento de un pago termina en un error legible en vez de duplicar.
create unique index if not exists invoice_payment_allocations_invoice_tx_uidx
  on public.invoice_payment_allocations (invoice_id, transaction_id);


-- -----------------------------------------------------------------------------
-- 4. Plan de cuotas
-- -----------------------------------------------------------------------------
create table if not exists public.invoice_installments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  number integer not null check (number > 0),
  due_date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  paid_amount numeric(12, 2) not null default 0 check (paid_amount >= 0),
  status public.invoice_installment_status not null default 'pending',
  notes text,

  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.invoice_installments is
  'Cuotas de una factura a crédito. `paid_amount` y `status` los recalcula un trigger.';

create unique index if not exists invoice_installments_invoice_number_uidx
  on public.invoice_installments (invoice_id, number);
create index if not exists invoice_installments_due_date_idx
  on public.invoice_installments (due_date);

drop trigger if exists invoice_installments_set_updated_at on public.invoice_installments;
create trigger invoice_installments_set_updated_at
  before update on public.invoice_installments
  for each row
  execute function public.handle_updated_at();

-- La cuota referencia el plan; se agrega después para poder crear la tabla de
-- asignaciones antes (evita un ciclo de dependencias).
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoice_payment_allocations_installment_id_fkey'
      and conrelid = 'public.invoice_payment_allocations'::regclass
  ) then
    alter table public.invoice_payment_allocations
      add constraint invoice_payment_allocations_installment_id_fkey
      foreign key (installment_id)
      references public.invoice_installments (id)
      on delete cascade;
  end if;
end
$$;


-- -----------------------------------------------------------------------------
-- 5. Recálculo automático de importes
--
--    `invoice_installments.paid_amount` y `invoices.paid_amount` son espejos de
--    `invoice_payment_allocations`: ninguna pantalla los escribe a mano.
-- -----------------------------------------------------------------------------

-- Estado de una cuota según lo abonado y el vencimiento.
create or replace function public.refresh_invoice_installment()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_paid numeric(12, 2);
begin
  select coalesce(sum(a.amount), 0)
  into v_paid
  from public.invoice_payment_allocations a
  where a.installment_id = new.id;

  new.paid_amount := least(v_paid, new.amount);
  new.status := case
    when new.paid_amount >= new.amount then 'paid'::public.invoice_installment_status
    when new.due_date < current_date then 'overdue'::public.invoice_installment_status
    when new.paid_amount > 0 then 'partial'::public.invoice_installment_status
    else 'pending'::public.invoice_installment_status
  end;

  return new;
end;
$$;

comment on function public.refresh_invoice_installment() is
  'Recalcula paid_amount y status de una cuota a partir de los cobros aplicados.';

drop trigger if exists invoice_installments_refresh_totals on public.invoice_installments;
create trigger invoice_installments_refresh_totals
  before insert or update on public.invoice_installments
  for each row
  execute function public.refresh_invoice_installment();


-- Totales de la factura (paid_amount + payment_status).
create or replace function public.refresh_invoice_payment_totals(p_invoice_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_paid numeric(12, 2);
  v_total numeric(12, 2);
  v_status public.invoice_payment_status;
begin
  select coalesce(sum(a.amount), 0)
  into v_paid
  from public.invoice_payment_allocations a
  where a.invoice_id = p_invoice_id;

  select i.total into v_total from public.invoices i where i.id = p_invoice_id;

  if v_total is null then
    return;
  end if;

  -- Una factura nunca cobra más de lo que vale: el excedente se devuelve al
  -- paciente desde caja, no se acumula acá.
  v_paid := least(round(v_paid, 0), v_total);
  v_status := case
    when v_paid <= 0 then 'unpaid'::public.invoice_payment_status
    when v_paid >= v_total then 'paid'::public.invoice_payment_status
    else 'partial'::public.invoice_payment_status
  end;

  update public.invoices i
  set paid_amount = v_paid,
      payment_status = v_status
  where i.id = p_invoice_id
    and (i.paid_amount <> v_paid or i.payment_status <> v_status);
end;
$$;

comment on function public.refresh_invoice_payment_totals(uuid) is
  'Sincroniza invoices.paid_amount y payment_status con los cobros aplicados.';



-- Arrastra los totales a la factura y a la cuota afectadas.
create or replace function public.sync_invoice_payment_totals()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    -- Tocar la fila dispara `refresh_invoice_installment`, que recalcula
    -- paid_amount y status desde las asignaciones.
    if old.installment_id is not null then
      update public.invoice_installments i
      set updated_at = now()
      where i.id = old.installment_id;
    end if;

    perform public.refresh_invoice_payment_totals(old.invoice_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    if new.installment_id is not null then
      update public.invoice_installments i
      set updated_at = now()
      where i.id = new.installment_id;
    end if;

    perform public.refresh_invoice_payment_totals(new.invoice_id);
  end if;

  return null;
end;
$$;

comment on function public.sync_invoice_payment_totals() is
  'Trigger de invoice_payment_allocations: arrastra los totales a la factura y la cuota.';

drop trigger if exists invoice_payment_allocations_sync_totals on public.invoice_payment_allocations;
create trigger invoice_payment_allocations_sync_totals
  after insert or update or delete on public.invoice_payment_allocations
  for each row
  execute function public.sync_invoice_payment_totals();


-- Si cambia el total (ajuste manual), el estado de cobro se recalcula.
create or replace function public.sync_invoice_totals_on_total_change()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.refresh_invoice_payment_totals(new.id);

  return null;
end;
$$;

drop trigger if exists invoices_refresh_totals_on_total_change on public.invoices;
create trigger invoices_refresh_totals_on_total_change
  after update of total on public.invoices
  for each row
  when (old.total is distinct from new.total)
  execute function public.sync_invoice_totals_on_total_change();




-- -----------------------------------------------------------------------------
-- 6. Vista de facturación por movimiento de caja
--    La caja necesita saber, para cada cobro, cuánto ya se facturó y cuánto
--    queda disponible para emitir una factura.
-- -----------------------------------------------------------------------------
create or replace view public.transaction_invoicing
with (security_invoker = true) as
select
  t.id as transaction_id,
  t.patient_id,
  t.type,
  t.status,
  t.amount,
  coalesce(sum(a.amount), 0) as invoiced_amount,
  greatest(t.amount - coalesce(sum(a.amount), 0), 0) as available_amount,
  count(a.id) as invoice_count,
  array_remove(
    array_agg(distinct i.invoice_number order by i.invoice_number),
    null
  ) as invoice_numbers
from public.transactions t
left join public.invoice_payment_allocations a on a.transaction_id = t.id
left join public.invoices i on i.id = a.invoice_id
group by t.id;

comment on view public.transaction_invoicing is
  'Por cada movimiento de caja: cuánto está facturado, cuánto queda disponible y con qué facturas.';


-- -----------------------------------------------------------------------------
-- 7. Aplicar un cobro existente a una factura
--    Función interna: valida paciente, saldo del cobro y saldo de la factura.
-- -----------------------------------------------------------------------------
create or replace function public.link_invoice_payment(
  p_invoice_id uuid,
  p_transaction_id uuid,
  p_amount numeric,
  p_installment_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_invoice public.invoices;
  v_tx public.transactions;
  v_amount numeric(12, 2);
  v_available numeric(12, 2);
  v_installment_id uuid;
  v_allocation_id uuid;
begin
  select * into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'La factura no existe.';
  end if;

  if v_invoice.status <> 'issued'::public.invoice_status then
    raise exception 'Solo se cobran facturas emitidas (la factura está en estado %).', v_invoice.status;
  end if;

  if v_invoice.patient_id is null then
    raise exception 'La factura no tiene paciente asociado: no se puede aplicar un cobro de caja.';
  end if;

  select * into v_tx
  from public.transactions
  where id = p_transaction_id;

  if not found then
    raise exception 'El movimiento de caja no existe.';
  end if;

  if v_tx.patient_id <> v_invoice.patient_id then
    raise exception 'El cobro pertenece a otro paciente.';
  end if;

  if v_tx.type <> 'payment'::public.transaction_type then
    raise exception 'Solo los cobros (payment) se aplican a una factura.';
  end if;

  if v_tx.status in ('pending'::public.transaction_status, 'cancelled'::public.transaction_status) then
    raise exception 'El cobro todavía no está confirmado en caja.';
  end if;

  v_amount := round(coalesce(p_amount, 0), 0);

  if v_amount <= 0 then
    raise exception 'El importe del cobro debe ser mayor a cero.';
  end if;

  v_available := v_tx.amount - coalesce((
    select sum(a.amount)
    from public.invoice_payment_allocations a
    where a.transaction_id = p_transaction_id
  ), 0);

  if v_invoice.paid_amount + v_amount > v_invoice.total or v_amount > v_invoice.balance then
    raise exception 'El cobro (%) supera el saldo de la factura (%).', v_amount, v_invoice.balance;
  end if;

  if v_amount > v_available then
    raise exception 'El cobro ya está facturado: quedan % disponibles.', greatest(v_available, 0);
  end if;

  -- Cuota destino: la elegida o, si no, la primera impaga del plan.
  if p_installment_id is not null then
    select i.id into v_installment_id
    from public.invoice_installments i
    where i.id = p_installment_id
      and i.invoice_id = p_invoice_id;

    if v_installment_id is null then
      raise exception 'La cuota indicada no pertenece a la factura.';
    end if;
  else
    select i.id into v_installment_id
    from public.invoice_installments i
    where i.invoice_id = p_invoice_id
      and i.paid_amount < i.amount
    order by i.number
    limit 1;
  end if;

  insert into public.invoice_payment_allocations (invoice_id, installment_id, transaction_id, amount)
  values (p_invoice_id, v_installment_id, p_transaction_id, v_amount)
  returning id into v_allocation_id;

  perform public.refresh_invoice_payment_totals(p_invoice_id);

  return v_allocation_id;
end;
$$;

comment on function public.link_invoice_payment(uuid, uuid, numeric, uuid) is
  'Aplica un cobro de caja a una factura (y a una cuota si corresponde).';


-- -----------------------------------------------------------------------------
-- 8. Registrar un cobro (abono) desde Facturación
--    Crea el movimiento en caja y lo aplica a la factura en una sola
--    transacción: no puede quedar plata en caja sin factura ni factura cobrada
--    sin movimiento.
-- -----------------------------------------------------------------------------
create or replace function public.register_invoice_payment(p_payment jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_invoice public.invoices;
  v_amount numeric(12, 2);
  v_method public.payment_method;
  v_paid_at timestamptz;
  v_receipt text;
  v_transaction_id uuid;
  v_allocation_id uuid;
  v_updated public.invoices;
begin
  select * into v_invoice
  from public.invoices
  where id = nullif(btrim(coalesce(p_payment ->> 'invoice_id', '')), '')::uuid
  for update;

  if not found then
    raise exception 'La factura no existe.';
  end if;

  if v_invoice.status <> 'issued'::public.invoice_status then
    raise exception 'Solo se cobran facturas emitidas (la factura está en estado %).', v_invoice.status;
  end if;

  if v_invoice.patient_id is null then
    raise exception 'La factura necesita un paciente para registrar el cobro en caja.';
  end if;

  v_amount := round(coalesce((p_payment ->> 'amount')::numeric, 0), 0);

  if v_amount <= 0 then
    raise exception 'El importe del cobro debe ser mayor a cero.';
  end if;

  if v_amount > v_invoice.balance then
    raise exception 'El cobro (%) supera el saldo pendiente (%).', v_amount, v_invoice.balance;
  end if;

  v_method := nullif(btrim(coalesce(p_payment ->> 'method', '')), '')::public.payment_method;
  v_receipt := nullif(upper(btrim(coalesce(p_payment ->> 'receipt_number', ''))), '');
  v_paid_at := coalesce(
    nullif(btrim(coalesce(p_payment ->> 'paid_at', '')), '')::timestamptz,
    now()
  );

  insert into public.transactions (
    patient_id, type, status, method, amount, currency,
    paid_at, receipt_number, reference, notes, created_by
  )
  values (
    v_invoice.patient_id,
    'payment'::public.transaction_type,
    'paid'::public.transaction_status,
    v_method,
    v_amount,
    v_invoice.currency,
    v_paid_at,
    v_receipt,
    nullif(btrim(coalesce(p_payment ->> 'reference', '')), ''),
    coalesce(
      nullif(btrim(coalesce(p_payment ->> 'notes', '')), ''),
      format('Cobro de la factura %s', v_invoice.invoice_number)
    ),
    auth.uid()
  )
  returning id into v_transaction_id;

  v_allocation_id := public.link_invoice_payment(
    v_invoice.id,
    v_transaction_id,
    v_amount,
    nullif(btrim(coalesce(p_payment ->> 'installment_id', '')), '')::uuid
  );

  select * into v_updated from public.invoices where id = v_invoice.id;

  return jsonb_build_object(
    'invoice', to_jsonb(v_updated),
    'transaction_id', v_transaction_id,
    'allocation_id', v_allocation_id
  );
end;
$$;

comment on function public.register_invoice_payment(jsonb) is
  'Registra un cobro/abono en caja y lo aplica a la factura de forma atómica.';


-- -----------------------------------------------------------------------------
-- 9. Plan de cuotas
--    Reemplaza el plan completo. Se rechaza si alguna cuota ya tiene cobros
--    aplicados (primero hay que anular esos cobros desde caja).
-- -----------------------------------------------------------------------------
create or replace function public.plan_invoice_installments(p_invoice_id uuid, p_installments jsonb)
returns setof public.invoice_installments
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_invoice public.invoices;
  v_count integer;
  v_sum numeric(12, 2);
begin
  select * into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'La factura no existe.';
  end if;

  if v_invoice.status <> 'issued'::public.invoice_status then
    raise exception 'Solo se planifican facturas emitidas.';
  end if;

  if p_installments is null or jsonb_typeof(p_installments) <> 'array' then
    raise exception 'El plan de cuotas debe ser una lista.';
  end if;

  v_count := jsonb_array_length(p_installments);

  if v_count < 1 or v_count > 60 then
    raise exception 'La cantidad de cuotas debe estar entre 1 y 60.';
  end if;

  if exists (
    select 1
    from public.invoice_payment_allocations a
    join public.invoice_installments i on i.id = a.installment_id
    where i.invoice_id = p_invoice_id
  ) then
    raise exception 'No se puede replanificar: hay cuotas con cobros aplicados.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_installments) e
    where nullif(btrim(coalesce(e.value ->> 'due_date', '')), '') is null
       or round(coalesce((e.value ->> 'amount')::numeric, 0), 0) <= 0
  ) then
    raise exception 'Cada cuota necesita fecha de vencimiento e importe mayor a cero.';
  end if;

  select coalesce(sum(round((e.value ->> 'amount')::numeric, 0)), 0)
  into v_sum
  from jsonb_array_elements(p_installments) e;

  if abs(v_sum - v_invoice.total) > 1 then
    raise exception 'Las cuotas suman % y la factura es de %.', v_sum, v_invoice.total;
  end if;

  delete from public.invoice_installments i where i.invoice_id = p_invoice_id;

  insert into public.invoice_installments (invoice_id, number, due_date, amount, notes)
  select
    p_invoice_id,
    coalesce(nullif(e.value ->> 'number', '')::integer, e.ordinality::integer),
    (e.value ->> 'due_date')::date,
    round((e.value ->> 'amount')::numeric, 0),
    nullif(btrim(coalesce(e.value ->> 'notes', '')), '')
  from jsonb_array_elements(p_installments) with ordinality as e(value, ordinality);

  update public.invoices i
  set installments_count = v_count,
      condition = case
        when v_count > 1 then 'credito'::public.invoice_condition
        else i.condition
      end
  where i.id = p_invoice_id;

  return query
    select *
    from public.invoice_installments i
    where i.invoice_id = p_invoice_id
    order by i.number;
end;
$$;

comment on function public.plan_invoice_installments(uuid, jsonb) is
  'Define (o reemplaza) las cuotas de una factura emitida y sincroniza installments_count.';


-- -----------------------------------------------------------------------------
-- 10. Emisión de la factura con condición de pago, cuotas y cobros
--
--     Extiende `issue_invoice` (20261111100000_invoicing_paraguay.sql). Claves
--     nuevas del payload, todas opcionales:
--       condition            'contado' | 'credito'
--       installments         [{ due_date, amount, number?, notes? }]
--       payment_allocations  [{ transaction_id, amount, installment_id? }]
--                            cobros ya registrados en caja que pagan la factura
--       cash_payment         { amount, method, receipt_number?, paid_at?,
--                              reference?, notes? }
--                            cobro nuevo: se crea el movimiento en caja
--
--     El `transaction_id` suelto sigue funcionando: se aplica como un cobro más
--     por el importe del movimiento (tope: el total de la factura).
-- -----------------------------------------------------------------------------
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
  v_condition public.invoice_condition;
  v_installment_count integer;
  v_transaction_id uuid;
  v_has_allocations boolean;
  v_allocation jsonb;
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

  -- Condición de pago y cuotas. Si vienen cuotas, la factura es a crédito.
  v_installment_count := case
    when jsonb_typeof(p_invoice -> 'installments') = 'array'
      then jsonb_array_length(p_invoice -> 'installments')
    else 0
  end;

  v_condition := coalesce(
    nullif(btrim(coalesce(p_invoice ->> 'condition', '')), '')::public.invoice_condition,
    case
      when v_installment_count > 1 then 'credito'::public.invoice_condition
      else 'contado'::public.invoice_condition
    end
  );

  if v_condition = 'contado'::public.invoice_condition and v_installment_count > 1 then
    raise exception 'Una factura al contado no puede tener % cuotas.', v_installment_count;
  end if;

  insert into public.invoices (
    issuer_id, timbrado_id, patient_id, transaction_id,
    timbrado_number, establishment, emission_point, sequence_number,
    invoice_number, mode, cdc, status, issued_at,
    customer_name, customer_ruc, customer_document, customer_email, customer_address,
    vat_rate, amount_10, amount_5, amount_exempt, iva_10, iva_5, total,
    condition, installments_count,
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
    v_condition,
    greatest(v_installment_count, 1),
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

  -- Plan de cuotas (valida que sumen el total de la factura).
  if v_installment_count > 0 then
    perform public.plan_invoice_installments(v_row.id, p_invoice -> 'installments');
  end if;

  -- Cobros: primero los que ya están en caja, después un cobro nuevo.
  v_has_allocations := jsonb_typeof(p_invoice -> 'payment_allocations') = 'array'
    and jsonb_array_length(p_invoice -> 'payment_allocations') > 0;

  if v_has_allocations then
    for v_allocation in
      select e.value from jsonb_array_elements(p_invoice -> 'payment_allocations') as e
    loop
      perform public.link_invoice_payment(
        v_row.id,
        nullif(btrim(coalesce(v_allocation ->> 'transaction_id', '')), '')::uuid,
        coalesce((v_allocation ->> 'amount')::numeric, 0),
        nullif(btrim(coalesce(v_allocation ->> 'installment_id', '')), '')::uuid
      );
    end loop;
  elsif jsonb_typeof(p_invoice -> 'cash_payment') = 'object' then
    perform public.register_invoice_payment(
      jsonb_build_object(
        'invoice_id', v_row.id,
        'amount', p_invoice -> 'cash_payment' ->> 'amount',
        'method', p_invoice -> 'cash_payment' ->> 'method',
        'receipt_number', p_invoice -> 'cash_payment' ->> 'receipt_number',
        'paid_at', p_invoice -> 'cash_payment' ->> 'paid_at',
        'reference', p_invoice -> 'cash_payment' ->> 'reference',
        'notes', p_invoice -> 'cash_payment' ->> 'notes',
        'installment_id', p_invoice -> 'cash_payment' ->> 'installment_id'
      )
    );
  else
    v_transaction_id := nullif(btrim(coalesce(p_invoice ->> 'transaction_id', '')), '')::uuid;

    -- Compatibilidad: factura vinculada a un cobro suelto, sin detalle de
    -- asignaciones. Se aplica por el importe del movimiento (tope: el total).
    -- Sin paciente no hay forma de vincular el cobro: queda solo la referencia.
    if v_transaction_id is not null and v_row.patient_id is not null then
      perform public.link_invoice_payment(
        v_row.id,
        v_transaction_id,
        least(
          coalesce((select t.amount from public.transactions t where t.id = v_transaction_id), 0),
          v_total
        ),
        null
      );
    end if;
  end if;

  -- Devuelve la fila con los totales ya sincronizados.
  select * into v_row from public.invoices where id = v_row.id;

  return v_row;
end;
$$;

comment on function public.issue_invoice(uuid, jsonb) is
  'Emite una factura de forma atómica: valida el timbrado, resuelve el correlativo, crea las cuotas y aplica los cobros de caja.';


-- -----------------------------------------------------------------------------
-- 11. Datos existentes
--     Las facturas ya vinculadas a un cobro (`transaction_id`) reciben su
--     asignación, así `paid_amount` y el saldo son reales desde el primer día.
-- -----------------------------------------------------------------------------
insert into public.invoice_payment_allocations (invoice_id, transaction_id, amount)
select i.id, i.transaction_id, least(t.amount, i.total)
from public.invoices i
join public.transactions t on t.id = i.transaction_id
where i.transaction_id is not null
  and i.status = 'issued'::public.invoice_status
  and t.type = 'payment'::public.transaction_type
  and t.status in ('paid'::public.transaction_status, 'partially_paid'::public.transaction_status)
  and not exists (
    select 1 from public.invoice_payment_allocations a where a.invoice_id = i.id
  )
on conflict do nothing;


-- -----------------------------------------------------------------------------
-- 12. RLS, permisos y caché de PostgREST
--     Mismo criterio que el resto del esquema: cualquier usuario autenticado
--     gestiona los datos; `anon` no accede a nada.
-- -----------------------------------------------------------------------------
alter table public.invoice_payment_allocations enable row level security;
alter table public.invoice_installments enable row level security;

drop policy if exists "invoice_payment_allocations_manage_authenticated" on public.invoice_payment_allocations;
create policy "invoice_payment_allocations_manage_authenticated"
  on public.invoice_payment_allocations
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "invoice_installments_manage_authenticated" on public.invoice_installments;
create policy "invoice_installments_manage_authenticated"
  on public.invoice_installments
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.invoice_payment_allocations,
     public.invoice_installments
  to authenticated;

revoke all
  on public.invoice_payment_allocations,
     public.invoice_installments
  from anon;

grant select on public.transaction_invoicing to authenticated;
revoke all on public.transaction_invoicing from anon;

-- Las funciones nacen con EXECUTE para PUBLIC: se cierra y se abre solo al
-- personal autenticado.
revoke all on function public.refresh_invoice_payment_totals(uuid) from public, anon;
revoke all on function public.link_invoice_payment(uuid, uuid, numeric, uuid) from public, anon;
revoke all on function public.register_invoice_payment(jsonb) from public, anon;
revoke all on function public.plan_invoice_installments(uuid, jsonb) from public, anon;

grant execute on function public.refresh_invoice_payment_totals(uuid) to authenticated;
grant execute on function public.link_invoice_payment(uuid, uuid, numeric, uuid) to authenticated;
grant execute on function public.register_invoice_payment(jsonb) to authenticated;
grant execute on function public.plan_invoice_installments(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
