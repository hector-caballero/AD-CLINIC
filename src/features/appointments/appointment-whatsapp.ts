import {
  CLINIC_NAME,
  formatReminderDate,
  getWhatsAppNumber,
} from '../../services/whatsapp'
import type { AppointmentWithPatient } from './appointment-types'
import { formatAppointmentTime } from './appointment-dates'

/**
 * Enlaces manuales de WhatsApp (`https://wa.me/<número>`).
 *
 * Es el camino alternativo al envío automático de `src/services/whatsapp.ts`
 * (Evolution API): abre WhatsApp Web/App con el mensaje ya escrito para que la
 * recepcionista lo revise y lo envíe a mano. La normalización del número vive
 * en el servicio, así ambos caminos usan exactamente el mismo formato
 * (`0981 123 456` → `595981123456`).
 */

export { CLINIC_NAME, formatReminderDate }

/** Teléfono principal y, si no sirve, el alternativo (`595981123456`). */
export const getReminderNumber = getWhatsAppNumber

/** Mensaje precargado en WhatsApp con fecha, horario y motivo. */
export function buildReminderMessage(appointment: AppointmentWithPatient): string {
  const firstName = appointment.patient?.first_name?.trim() || 'paciente'
  const date = formatReminderDate(appointment.starts_at)
  const start = formatAppointmentTime(appointment.starts_at)
  const end = formatAppointmentTime(appointment.ends_at)

  return [
    `Hola ${firstName}, te escribimos de ${CLINIC_NAME}.`,
    `Te recordamos tu cita del ${date} de ${start} a ${end} hs.`,
    `Motivo: ${appointment.reason}.`,
    'Si no podés asistir, avisanos por este medio. ¡Gracias!',
  ].join('\n')
}

/** Enlace listo para abrir WhatsApp Web/App, o `null` si no hay teléfono válido. */
export function buildReminderUrl(appointment: AppointmentWithPatient): string | null {
  const number = getReminderNumber(appointment.patient)

  if (!number) return null

  return `https://wa.me/${number}?text=${encodeURIComponent(buildReminderMessage(appointment))}`
}
