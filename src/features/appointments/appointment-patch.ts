import type { AppointmentStatus } from './appointment-types'

/**
 * Payload de estado para `public.appointments`.
 *
 * - `checked_in` marca la llegada del paciente.
 * - `completed` marca la atención (conserva `checked_in_at` si existía).
 * - `cancelled` exige motivo (`appointments_cancellation_reason_check`).
 * - Reabrir limpia las marcas para que las métricas no cuenten doble.
 */
export type AppointmentStatusPatch = {
  status: AppointmentStatus
  checked_in_at?: string | null
  completed_at?: string | null
  cancellation_reason?: string | null
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

  patch.cancellation_reason =
    status === 'cancelled' ? options.cancellationReason?.trim() || 'Sin motivo especificado' : null

  return patch
}
