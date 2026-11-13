-- -----------------------------------------------------------------------------
-- RUC de emisores: base de 5 a 8 dígitos
--
-- El constraint original pedía 6 a 8 dígitos de base, pero en Paraguay las
-- personas físicas usan bases más cortas (`3870633-4`, `80012345-6`). Se
-- reemplaza por una validación flexible: 5 a 8 dígitos + guion + DV.
--
-- Idempotente: si `tax_issuers` todavía no existe (proyecto sin la migración de
-- facturación aplicada) no hace nada, así que puede correrse en cualquier orden.
-- -----------------------------------------------------------------------------

do $$
declare
  v_constraint text;
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'tax_issuers'
  ) then
    raise notice 'tax_issuers no existe: se omite la corrección del RUC.';
    return;
  end if;

  -- El nombre por defecto es `tax_issuers_ruc_check`; se buscan todos los check
  -- que mencionen el RUC para no quedar con una regla vieja activa.
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.tax_issuers'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%ruc%'
  loop
    execute format('alter table public.tax_issuers drop constraint %I', v_constraint);
  end loop;

  alter table public.tax_issuers
    add constraint tax_issuers_ruc_check
    check (ruc ~ '^[0-9]{5,8}-[0-9]$') not valid;

  begin
    alter table public.tax_issuers validate constraint tax_issuers_ruc_check;
  exception
    when others then
      -- Emisores viejos con un RUC fuera de formato: la regla sigue aplicando a
      -- los registros nuevos, pero no se bloquea la migración.
      raise warning 'El constraint tax_issuers_ruc_check quedó sin validar: %', sqlerrm;
  end;

  comment on column public.tax_issuers.ruc is
    'RUC con dígito verificador: base de 5 a 8 dígitos, guion y DV (3870633-4, 80012345-6).';
end $$;
