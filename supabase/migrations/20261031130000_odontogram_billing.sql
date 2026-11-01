-- =============================================================================
-- AD Clinic · Cobrar el plan del odontograma
-- -----------------------------------------------------------------------------
-- «Cobrar este plan» ejecuta el mismo flujo que la caja
-- (`registerTreatmentCharge`): crea un `patient_treatments` y un `charge` por
-- cada línea elegida. Esta migración agrega el enlace que permite saber qué
-- línea del odontograma ya tiene un movimiento de caja, evitando cobrarla dos
-- veces y mostrando el estado real en el mapa dental.
--
-- Requiere `20261031120000_odontogram_and_budget.sql`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enlace con el tratamiento realizado en caja
--    `on delete set null`: si se borra el movimiento, la línea clínica se
--    conserva (el odontograma no pierde la pieza ni el procedimiento).
-- -----------------------------------------------------------------------------
alter table public.odontogram_items
  add column if not exists patient_treatment_id uuid
    references public.patient_treatments (id) on delete set null;

comment on column public.odontogram_items.patient_treatment_id is
  'Tratamiento realizado en caja que corresponde a esta línea. NULL = todavía no cobrado.';


-- -----------------------------------------------------------------------------
-- 2. Un movimiento de caja corresponde a una sola línea del odontograma
--    (el índice parcial ignora las líneas sin cobrar).
-- -----------------------------------------------------------------------------
create unique index if not exists odontogram_items_patient_treatment_key
  on public.odontogram_items (patient_treatment_id)
  where patient_treatment_id is not null;


-- -----------------------------------------------------------------------------
-- 3. Una línea cobrada siempre está realizada
--    El servicio marca `completed` + `performed_at` en la misma actualización;
--    la base rechaza cualquier estado distinto para una línea con cobro.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'odontogram_items_billed_check'
      and conrelid = 'public.odontogram_items'::regclass
  ) then
    alter table public.odontogram_items
      add constraint odontogram_items_billed_check
      check (patient_treatment_id is null or status = 'completed');
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 4. Líneas pendientes de cobro por odontograma
-- -----------------------------------------------------------------------------
create index if not exists odontogram_items_unbilled_idx
  on public.odontogram_items (odontogram_id)
  where patient_treatment_id is null and status <> 'absent';


-- -----------------------------------------------------------------------------
-- 5. Caché de PostgREST
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';
