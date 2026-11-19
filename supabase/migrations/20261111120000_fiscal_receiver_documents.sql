-- =============================================================================
-- AD Clinic — Documentos fiscales del paciente y del receptor
--
-- Objetivo (DNIT, Paraguay):
--   1. `patients.legal_name` guarda la razón social del contribuyente que se
--      autocompleta desde Tu RUC; se usa como «Razón social» al facturar.
--   2. `clinic_tax_settings` guarda el nombre y el RUC genérico del cliente
--      ocasional (consumidor final). La DNIT usa `44444401-7`; hay contadores
--      que prefieren otro valor, por eso es configurable.
--
-- Requisitos:
--   - `20261111100000_invoicing_paraguay.sql` (tabla clinic_tax_settings).
--   - `20261111110000_invoicing_ruc_width.sql` (ancho del RUC).
--
-- La migración es idempotente: se puede volver a ejecutar sin efectos.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Razón social del paciente (contribuyente)
--    Solo aplica a fichas con `document_type = 'RUC'`; la C.I. sigue sin DV.
-- -----------------------------------------------------------------------------
alter table public.patients
  add column if not exists legal_name text;

comment on column public.patients.legal_name is
  'Razón social o nombre oficial del contribuyente (consulta Tu RUC/DNIT). Se usa como razón social al facturar.';

-- -----------------------------------------------------------------------------
-- 2. Cliente ocasional (consumidor final)
--    `clinic_tax_settings` puede no existir todavía si la migración de
--    facturación no se aplicó: en ese caso se omite el bloque.
-- -----------------------------------------------------------------------------
alter table if exists public.clinic_tax_settings
  add column if not exists occasional_customer_name text not null default 'CLIENTE OCASIONAL';

alter table if exists public.clinic_tax_settings
  add column if not exists occasional_customer_ruc text not null default '44444401-7';

do $$
begin
  if to_regclass('public.clinic_tax_settings') is not null then
    execute $comment$
      comment on column public.clinic_tax_settings.occasional_customer_name is
        'Nombre/razón social con el que se factura a consumidor final (por defecto CLIENTE OCASIONAL).'
    $comment$;

    execute $comment$
      comment on column public.clinic_tax_settings.occasional_customer_ruc is
        'RUC genérico del consumidor final (DNIT: 44444401-7). Configurable por el contador.'
    $comment$;
  end if;
end
$$;
