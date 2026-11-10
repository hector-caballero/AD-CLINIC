-- =============================================================================
-- AD Clinic · Anamnesis / Historia clínica y Consentimiento informado
-- -----------------------------------------------------------------------------
-- Digitaliza la hoja física que se completa en la primera consulta:
--   1. ¿Bajo tratamiento o medicación?      (under_treatment)
--   2. ¿Presenta alguna enfermedad?          (has_disease)
--   3. Alergias: anestésicos, penicilina u otras (allergic_*)
--   4. Problemas odontológicos previos: hemorragias, reacciones (has_dental_issues)
--   5. ¿Dolor o molestias actuales?          (has_pain)
--   6. En caso de mujer: embarazo / lactancia (is_pregnant, is_breastfeeding)
--   7. En caso de niño/a: peso en kg          (child_weight_kg)
--   8. Consentimiento informado firmado       (consent_accepted, consent_signed_at)
--
-- Decisiones:
-- * Una sola ficha "activa" por paciente. La clave única `patient_id` es la que
--   permite guardar con `upsert ... on conflict (patient_id)`, así el formulario
--   siempre actualiza la misma fila en lugar de acumular versiones.
-- * Cada "Sí" tiene su campo de detalle al lado, tal como en la hoja de papel.
-- * Si se borra la ficha del paciente se borra su anamnesis (on delete cascade):
--   el borrado de pacientes es lógico (`deleted_at`), así que en la práctica no
--   se pierde nada.
-- =============================================================================

create table if not exists public.patient_medical_history (
  id uuid primary key default gen_random_uuid(),

  patient_id uuid not null references public.patients (id) on delete cascade,

  -- ¿Bajo tratamiento o medicación?
  under_treatment boolean not null default false,
  treatment_details text,

  -- ¿Presenta alguna enfermedad?
  has_disease boolean not null default false,
  disease_details text,

  -- Alergias
  allergic_anesthetics boolean not null default false,
  allergic_penicillin boolean not null default false,
  allergic_others boolean not null default false,
  allergic_details text,

  -- Problemas previos en tratamientos odontológicos (hemorragias, reacciones…)
  has_dental_issues boolean not null default false,
  dental_issues_details text,

  -- ¿Dolor o molestias actuales?
  has_pain boolean not null default false,
  pain_details text,

  -- En caso de mujer
  is_pregnant boolean not null default false,
  is_breastfeeding boolean not null default false,

  -- En caso de niño/a
  child_weight_kg numeric(5, 2),

  -- Consentimiento informado
  consent_accepted boolean not null default false,
  consent_signed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Una anamnesis activa por paciente: es la llave del `upsert` del formulario.
  constraint patient_medical_history_patient_key unique (patient_id),

  -- El peso pediátrico entra en la hoja de papel en kilos; un valor absurdo
  -- (negativo, 0 o más de 250 kg) solo puede venir de un error de tipeo.
  constraint patient_medical_history_child_weight_check
    check (child_weight_kg is null or (child_weight_kg > 0 and child_weight_kg <= 250))
);

comment on table public.patient_medical_history is
  'Anamnesis digital: la hoja de historia clínica y consentimiento informado de AD Clinic (una fila por paciente).';
comment on column public.patient_medical_history.patient_id is
  'Paciente dueño de la ficha. Único: una anamnesis activa por paciente.';
comment on column public.patient_medical_history.under_treatment is
  '¿Está bajo tratamiento o toma medicación? El detalle va en treatment_details.';
comment on column public.patient_medical_history.has_disease is
  '¿Presenta alguna enfermedad? El detalle va en disease_details.';
comment on column public.patient_medical_history.allergic_details is
  'Detalle de las alergias marcadas (anestésicos, penicilina u otras).';
comment on column public.patient_medical_history.has_dental_issues is
  'Antecedentes odontológicos: hemorragias, reacciones a anestesias previas, etc.';
comment on column public.patient_medical_history.child_weight_kg is
  'Peso en kilos para pacientes pediátricos. NULL en adultos.';
comment on column public.patient_medical_history.consent_accepted is
  'Consentimiento informado aceptado por el paciente o su tutor.';
comment on column public.patient_medical_history.consent_signed_at is
  'Fecha y hora de la firma. La mantiene el trigger handle_medical_history_consent().';


-- -----------------------------------------------------------------------------
-- 1. Triggers
-- -----------------------------------------------------------------------------

-- `updated_at` reutiliza la función genérica del esquema inicial.
drop trigger if exists patient_medical_history_set_updated_at
  on public.patient_medical_history;
create trigger patient_medical_history_set_updated_at
  before update on public.patient_medical_history
  for each row execute function public.handle_updated_at();

-- Coherencia del consentimiento: aceptado implica fecha de firma y, si se
-- desmarca, la fecha se limpia. Evita filas con "aceptado" pero sin firma (o al
-- revés) cuando el formulario se guarda desde el navegador.
create or replace function public.handle_medical_history_consent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.consent_accepted then
    new.consent_signed_at := coalesce(new.consent_signed_at, now());
  else
    new.consent_signed_at := null;
  end if;

  return new;
end;
$$;

comment on function public.handle_medical_history_consent() is
  'Sella consent_signed_at al aceptar el consentimiento y la limpia al desmarcarlo.';

drop trigger if exists patient_medical_history_consent on public.patient_medical_history;
create trigger patient_medical_history_consent
  before insert or update on public.patient_medical_history
  for each row execute function public.handle_medical_history_consent();


-- -----------------------------------------------------------------------------
-- 2. Row Level Security
--    Mismo criterio que el resto de las tablas clínicas: cualquier usuario
--    autenticado del consultorio lee y escribe; el rol `anon` no ve nada.
-- -----------------------------------------------------------------------------
alter table public.patient_medical_history enable row level security;

drop policy if exists "patient_medical_history_manage_authenticated"
  on public.patient_medical_history;
create policy "patient_medical_history_manage_authenticated"
  on public.patient_medical_history
  for all
  to authenticated
  using (true)
  with check (true);

revoke all on public.patient_medical_history from anon;
grant select, insert, update, delete on public.patient_medical_history to authenticated;
