-- =============================================================================
-- AD Clinic · Catálogo de tratamientos en guaraníes
-- -----------------------------------------------------------------------------
-- 1. Precios de referencia en PYG para el catálogo semilla.
--    La migración inicial cargó importes de ejemplo en dólares (45.00, 250.00…).
--    Este UPDATE solo toca las filas que TODAVÍA conservan ese valor placeholder,
--    así que nunca pisa precios ya ajustados desde /tratamientos.
-- 2. Índices para listar y buscar el catálogo por categoría / nombre / código.
--
-- Re-ejecutable (UPDATE idempotente + CREATE INDEX IF NOT EXISTS).
-- =============================================================================

update public.treatments as t
set default_price = seed.pyg_price
from (
  values
    ('PRO-001',   45.00,  150000),  -- Profilaxis
    ('PRO-002',   25.00,   80000),  -- Flúor
    ('PRO-003',   30.00,  100000),  -- Sellado de fosetas
    ('OPE-001',   65.00,  250000),  -- Obturación con resina
    ('OPE-002',  120.00,  400000),  -- Reconstrucción coronaria
    ('END-001',  250.00,  600000),  -- Endodoncia unirradicular
    ('END-002',  380.00,  900000),  -- Endodoncia multirradicular
    ('PER-001',   90.00,  350000),  -- Destartraje y alisado
    ('CIR-001',   80.00,  200000),  -- Extracción simple
    ('CIR-002',  220.00,  550000),  -- Extracción quirúrgica
    ('PRO-004',  450.00, 1200000),  -- Corona de porcelana
    ('PRO-005',  600.00, 2000000),  -- Prótesis parcial removible
    ('ORT-001',   70.00,  250000),  -- Control de ortodoncia
    ('EST-001',  300.00,  900000),  -- Blanqueamiento dental
    ('IMG-001',   15.00,   50000),  -- Radiografía periapical
    ('IMG-002',   40.00,  150000)   -- Radiografía panorámica
) as seed (code, usd_price, pyg_price)
where t.code = seed.code
  and t.default_price = seed.usd_price;

comment on column public.treatments.default_price is
  'Precio de referencia en guaraníes (PYG, sin centavos). Se congela en patient_treatments.unit_price al cobrar.';

comment on column public.treatments.default_duration_minutes is
  'Duración estimada del tratamiento en minutos (5 a 600). Se usa para agendar la cita.';


create index if not exists treatments_category_name_idx
  on public.treatments (category, lower(name));

create index if not exists treatments_code_search_idx
  on public.treatments (upper(code));


-- Recargar la caché de esquema de PostgREST (Supabase API)
notify pgrst, 'reload schema';
