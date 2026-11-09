-- =============================================================================
-- AD Clinic · Respuestas de los pacientes por WhatsApp
-- -----------------------------------------------------------------------------
-- 1. Marca en la cita cuál fue la última respuesta del paciente.
-- 2. Crea `appointment_responses`: la bandeja de entrada de los mensajes que
--    llegan a la instancia `ad-clinic` de Evolution API.
--
-- La tabla es, además, la barrera de idempotencia del webhook: Evolution
-- reintenta hasta 10 veces con backoff exponencial, así que cada mensaje de
-- WhatsApp se procesa exactamente una vez gracias a la clave única
-- `wa_message_id`.
-- =============================================================================

-- 1. Respuesta del paciente sobre su cita -------------------------------------
alter table public.appointments
  add column if not exists patient_response text
    check (patient_response is null or patient_response in ('confirm', 'reschedule')),
  add column if not exists patient_response_at timestamptz,
  add column if not exists reschedule_requested_at timestamptz;

comment on column public.appointments.patient_response is
  'Última respuesta del paciente por WhatsApp: confirmó (1) o pidió reagendar (2).';
comment on column public.appointments.patient_response_at is
  'Momento en que llegó esa respuesta. Es la hora del mensaje, no la del recordatorio.';
comment on column public.appointments.reschedule_requested_at is
  'El paciente pidió reagendar: recepción debe llamarlo. Se limpia al reprogramar.';

-- 2. Bandeja de entrada de WhatsApp -------------------------------------------
create table if not exists public.appointment_responses (
  id uuid primary key default gen_random_uuid(),

  -- Identificador del mensaje en WhatsApp: único por mensaje, no por instancia.
  wa_message_id text not null,
  phone text not null,
  body text,
  choice text not null
    check (choice in ('confirm', 'reschedule', 'unknown')),

  patient_id uuid references public.patients (id) on delete set null,
  appointment_id uuid references public.appointments (id) on delete set null,

  applied boolean not null default false,
  detail text,
  payload jsonb,

  received_at timestamptz not null default now(),

  constraint appointment_responses_wa_message_key unique (wa_message_id)
);

comment on table public.appointment_responses is
  'Mensajes recibidos por WhatsApp y su efecto en la agenda (auditoría del webhook).';
comment on column public.appointment_responses.choice is
  'Interpretación del texto: confirm (1), reschedule (2) o unknown.';
comment on column public.appointment_responses.detail is
  'Por qué no se aplicó (duplicate, patient_not_found, appointment_not_found…).';
comment on column public.appointment_responses.payload is
  'Payload saneado del evento: sin apikey ni tokens de Evolution API.';

create index if not exists appointment_responses_received_idx
  on public.appointment_responses (received_at desc);

create index if not exists appointment_responses_appointment_idx
  on public.appointment_responses (appointment_id);

-- 3. Acceso -------------------------------------------------------------------
-- La escritura la hace la Edge Function con `service_role` (salta RLS). El
-- personal autenticado solo lee; nadie más tiene acceso.
alter table public.appointment_responses enable row level security;

drop policy if exists "appointment_responses_read_authenticated" on public.appointment_responses;
create policy "appointment_responses_read_authenticated"
  on public.appointment_responses
  for select
  to authenticated
  using (true);

revoke all on public.appointment_responses from anon;
grant select on public.appointment_responses to authenticated;
