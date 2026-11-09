-- =============================================================================
-- AD Clinic · Aplicar la respuesta del paciente a su cita
-- -----------------------------------------------------------------------------
-- El webhook (`supabase/functions/whatsapp-webhook`) no escribe tablas: llama a
-- `apply_appointment_response`, que hace todo en una sola transacción:
--   1. registra el mensaje (idempotente por `wa_message_id`),
--   2. identifica al paciente por teléfono,
--   3. elige la cita pendiente más próxima,
--   4. aplica el estado (`confirmed` o `reschedule_requested`).
--
-- Así dos reintentos simultáneos de Evolution API no pueden aplicar dos veces la
-- misma respuesta, y la función queda fuera del alcance de `anon`/`authenticated`.
-- =============================================================================

/**
 * Paciente dueño de un teléfono, comparando los últimos 9 dígitos.
 *
 * `0981123456` (como se guarda en la app), `+595 981 123456` y
 * `595981123456` (como llega desde WhatsApp) apuntan al mismo móvil.
 */
create or replace function public.patient_id_by_phone(p_phone text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9) as tail
  )
  select p.id
  from public.patients p, target t
  where t.tail <> ''
    and p.deleted_at is null
    and (
      right(regexp_replace(p.phone, '\D', '', 'g'), 9) = t.tail
      or right(regexp_replace(coalesce(p.phone_alt, ''), '\D', '', 'g'), 9) = t.tail
    )
  -- El teléfono principal gana sobre el alternativo; luego el paciente más viejo.
  order by
    case
      when right(regexp_replace(p.phone, '\D', '', 'g'), 9) = t.tail then 0
      else 1
    end,
    p.created_at asc
  limit 1;
$$;

comment on function public.patient_id_by_phone(text) is
  'Devuelve el paciente cuyo teléfono principal o alternativo termina en los mismos 9 dígitos.';

/**
 * Aplica la respuesta "1" (confirmar) o "2" (reagendar) de un paciente.
 *
 * Devuelve siempre JSON, nunca lanza por un caso de negocio:
 *   { applied: true,  appointment_id, status, starts_at, patient_name }
 *   { applied: false, reason: 'duplicate' | 'unknown_choice'
 *                     | 'patient_not_found' | 'appointment_not_found' }
 */
create or replace function public.apply_appointment_response(
  p_wa_message_id text,
  p_phone text,
  p_body text,
  p_choice text,
  p_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response_id uuid;
  v_patient_id uuid;
  v_appointment public.appointments;
  v_received timestamptz := now();
begin
  -- 1. Registro de entrada: la clave única es la barrera de idempotencia.
  insert into public.appointment_responses (wa_message_id, phone, body, choice, payload)
  values (p_wa_message_id, p_phone, left(coalesce(p_body, ''), 500), p_choice, p_payload)
  on conflict (wa_message_id) do nothing
  returning id into v_response_id;

  if v_response_id is null then
    return jsonb_build_object('applied', false, 'reason', 'duplicate');
  end if;

  if p_choice not in ('confirm', 'reschedule') then
    update public.appointment_responses set detail = 'unknown_choice' where id = v_response_id;
    return jsonb_build_object('applied', false, 'reason', 'unknown_choice');
  end if;

  -- 2. ¿Quién escribe?
  v_patient_id := public.patient_id_by_phone(p_phone);

  if v_patient_id is null then
    update public.appointment_responses set detail = 'patient_not_found' where id = v_response_id;
    return jsonb_build_object('applied', false, 'reason', 'patient_not_found');
  end if;

  -- 3. Cita objetivo: la próxima cita abierta. El margen de 12 h hacia atrás
  --    cubre respuestas del mismo día y de la madrugada.
  select a.*
  into v_appointment
  from public.appointments a
  where a.patient_id = v_patient_id
    and a.status in ('scheduled', 'confirmed', 'checked_in', 'reschedule_requested')
    and a.starts_at >= v_received - interval '12 hours'
    and a.starts_at <= v_received + interval '120 days'
  order by a.starts_at asc
  limit 1;

  if v_appointment.id is null then
    update public.appointment_responses
       set patient_id = v_patient_id, detail = 'appointment_not_found'
     where id = v_response_id;

    return jsonb_build_object('applied', false, 'reason', 'appointment_not_found');
  end if;

  -- 4. Aplicar el cambio de estado.
  if p_choice = 'confirm' then
    update public.appointments
       set status = 'confirmed',
           patient_response = 'confirm',
           patient_response_at = v_received
     where id = v_appointment.id
    returning * into v_appointment;
  else
    update public.appointments
       set status = 'reschedule_requested',
           patient_response = 'reschedule',
           patient_response_at = v_received,
           reschedule_requested_at = v_received
     where id = v_appointment.id
    returning * into v_appointment;
  end if;

  update public.appointment_responses
     set applied = true,
         patient_id = v_patient_id,
         appointment_id = v_appointment.id
   where id = v_response_id;

  return jsonb_build_object(
    'applied', true,
    'appointment_id', v_appointment.id,
    'status', v_appointment.status,
    'starts_at', v_appointment.starts_at,
    'patient_id', v_patient_id,
    'patient_name', (
      select p.first_name from public.patients p where p.id = v_patient_id
    )
  );
end;
$$;

comment on function public.apply_appointment_response(text, text, text, text, jsonb) is
  'Registra y aplica la respuesta de un paciente a su próxima cita. Idempotente por wa_message_id.';

-- Solo la Edge Function (service_role) ejecuta estas funciones.
revoke all on function public.patient_id_by_phone(text) from public, anon, authenticated;
grant execute on function public.patient_id_by_phone(text) to service_role;

revoke all on function public.apply_appointment_response(text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_appointment_response(text, text, text, text, jsonb)
  to service_role;
