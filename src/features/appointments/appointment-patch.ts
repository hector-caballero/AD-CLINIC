import type { AppointmentStatus, PatientResponse } from './appointment-types'

/**
 * Payload de estado para `public.appointments`.
 *
 * - `checked_in` marca la llegada del paciente.
 * - `completed` marca la atención (conserva `checked_in_at` si existía).
 * - `cancelled` exige motivo (`appointments_cancellation_reason_check`).
 * - `reschedule_requested` registra que el paciente pidió mover la cita; en la
 *   agenda normalmente lo dispara el webhook de WhatsApp, no el personal.
 * - Cualquier cambio manual limpia la respuesta del paciente: el aviso «Confirmó
 *   por WhatsApp» deja de mostrarse porque recepción ya lo resolvió (la auditoría
 *   queda en la tabla `appointment_responses`).
 * - Reabrir limpia las marcas para que las métricas no cuenten doble.
 */
export type AppointmentStatusPatch = {
  status: AppointmentStatus
  checked_in_at?: string | null
  completed_at?: string | null
  cancellation_reason?: string | null
  reschedule_requested_at?: string | null
  patient_response?: PatientResponse | null
  patient_response_at?: string | null
  /** Se limpia al reabrir/reprogramar: el turnero deja de mostrar la llamada. */
  called_at?: string | null
}

export function buildStatusPatch(
  status: AppointmentStatus,
  options: { cancellationReason?: string; now?: Date } = {},
): AppointmentStatusPatch {
  const now = (options.now ?? new Date()).toISOString()
  const patch: AppointmentStatusPatch = { status }

  if (status === 'scheduled' || status === 'confirmed') {
    patch.checked_in_at = null
    patch.completed_at = null
  }

  if (status === 'checked_in') {
    patch.checked_in_at = now
    patch.completed_at = null
  }

  if (status === 'completed') {
    patch.completed_at = now
  }

  // La marca de llamada solo tiene sentido mientras el paciente está en sala o
  // ya fue atendido: al reabrir, cancelar o marcar inasistencia se borra para
  // que la tele no siga anunciando a alguien que ya no está.
  if (status !== 'checked_in' && status !== 'completed') {
    patch.called_at = null
  }

  if (status === 'reschedule_requested') {
    patch.checked_in_at = null
    patch.completed_at = null
    patch.reschedule_requested_at = now
    patch.patient_response = 'reschedule'
    patch.patient_response_at = now
  } else {
    patch.reschedule_requested_at = null
    patch.patient_response = null
    patch.patient_response_at = null
  }

  patch.cancellation_reason =
    status === 'cancelled' ? options.cancellationReason?.trim() || 'Sin motivo especificado' : null

  return patch
}

/**
 * Al reprogramar una cita que el paciente pidió mover, la cita vuelve a
 * `scheduled`: el pedido ya está resuelto y el recordatorio se puede mandar de
 * nuevo con el horario nuevo.
 */
export function buildRescheduleResetPatch(): AppointmentStatusPatch {
  return {
    status: 'scheduled',
    reschedule_requested_at: null,
    patient_response: null,
    patient_response_at: null,
    called_at: null,
  }
}

/**
 * Payload de «Llamar a sala» (lo consume el turnero `/tv`).
 *
 * La acción siempre deja la cita en `checked_in`: si el paciente ya estaba en
 * sala se conserva su hora de llegada; si no, se marca ahora. `called_at` se
 * reescribe en cada llamada, así que volver a llamar re-dispara el aviso en la
 * tele (el canal compara la marca anterior con la nueva).
 */
export type AppointmentCallPatch = {
  status: 'checked_in'
  checked_in_at: string
  called_at: string
  called_by: string | null
  completed_at: null
}

export function buildCallPatch(options: {
  now?: Date
  /** Hora de llegada previa: si existe, no se pisa. */
  checkedInAt?: string | null
  /** Usuario que llama (auditoría). */
  calledBy?: string | null
}): AppointmentCallPatch {
  const now = (options.now ?? new Date()).toISOString()

  return {
    status: 'checked_in',
    checked_in_at: options.checkedInAt ?? now,
    called_at: now,
    called_by: options.calledBy ?? null,
    completed_at: null,
  }
}

