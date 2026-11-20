-- -----------------------------------------------------------------------------
-- Preferencias de impresión por emisor fiscal
--
-- Contenido:
--   1. `tax_issuers.print_format` / `print_copies` / offsets en mm.
--   2. Backfill inicial según el timbrado activo más reciente del emisor.
--
-- Cada emisor (persona física o empresa) elige cómo se imprime su factura:
--
--   electronic_kude      KuDE A4 con QR y CDC de 44 dígitos (SIFEN).
--   autoimpresor_a4      Diseño fiscal completo sobre hoja A4 en blanco.
--   preprinted_overlay   Solo los datos, sin bordes ni membretes, para calzar
--                        sobre formularios preimpresos (con offsets en mm).
--   manual_none          Talonario manual: no se imprime factura fiscal; solo se
--                        registra en el Libro de Ventas y se ofrece un Recibo de
--                        Dinero A4.
--
-- Los offsets desplazan la capa de datos sobre el formulario preimpreso:
-- positivos mueven hacia la derecha/abajo. Se acotan a ±50 mm para que un error
-- de tipeo no deje los datos fuera de la hoja.
--
-- Idempotente: si `tax_issuers` todavía no existe (proyecto sin la migración de
-- facturación aplicada) no hace nada. El backfill solo corre la primera vez que
-- se agrega la columna, para no pisar una preferencia ya elegida por el usuario.
-- -----------------------------------------------------------------------------

do $$
declare
  v_is_first_run boolean := false;
begin
  if not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'tax_issuers'
  ) then
    raise notice 'tax_issuers no existe: se omite la migración de impresión por emisor.';
    return;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tax_issuers'
      and column_name = 'print_format'
  ) then
    v_is_first_run := true;
  end if;

  alter table public.tax_issuers
    add column if not exists print_format text not null default 'autoimpresor_a4',
    add column if not exists print_copies text not null default 'original_duplicate',
    add column if not exists print_offset_x_mm numeric(5, 1) not null default 0,
    add column if not exists print_offset_y_mm numeric(5, 1) not null default 0;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tax_issuers_print_format_check'
      and conrelid = 'public.tax_issuers'::regclass
  ) then
    alter table public.tax_issuers
      add constraint tax_issuers_print_format_check
      check (print_format in ('electronic_kude', 'autoimpresor_a4', 'preprinted_overlay', 'manual_none'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tax_issuers_print_copies_check'
      and conrelid = 'public.tax_issuers'::regclass
  ) then
    alter table public.tax_issuers
      add constraint tax_issuers_print_copies_check
      check (print_copies in ('original_only', 'original_duplicate'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'tax_issuers_print_offset_check'
      and conrelid = 'public.tax_issuers'::regclass
  ) then
    alter table public.tax_issuers
      add constraint tax_issuers_print_offset_check
      check (
        print_offset_x_mm between -50 and 50
        and print_offset_y_mm between -50 and 50
      );
  end if;

  -- Backfill: el formato sugerido acompaña a la modalidad del timbrado activo
  -- más reciente (electrónica → KuDE, preimpreso → caída, manual → manual).
  if v_is_first_run and exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'invoicing_timbrados'
  ) then
    update public.tax_issuers as issuer
    set print_format = case latest.mode
      when 'electronic' then 'electronic_kude'
      when 'preprinted' then 'preprinted_overlay'
      when 'manual' then 'manual_none'
      else 'autoimpresor_a4'
    end
    from (
      select distinct on (t.issuer_id)
        t.issuer_id,
        t.mode
      from public.invoicing_timbrados as t
      where t.is_active
      order by t.issuer_id, t.valid_from desc, t.created_at desc
    ) as latest
    where latest.issuer_id = issuer.id;
  end if;

  comment on column public.tax_issuers.print_format is
    'Formato de impresión de facturas: electronic_kude, autoimpresor_a4, preprinted_overlay o manual_none.';
  comment on column public.tax_issuers.print_copies is
    'Copias por emisión: original_only u original_duplicate.';
  comment on column public.tax_issuers.print_offset_x_mm is
    'Margen izquierdo en mm para calzar sobre formularios preimpresos (±50).';
  comment on column public.tax_issuers.print_offset_y_mm is
    'Margen superior en mm para calzar sobre formularios preimpresos (±50).';
end $$;
