import type { AppointmentPatient, AppointmentWithPatient } from './appointment-types'
import { formatAppointmentTime } from './appointment-dates'

/**
 * Recordatorio por WhatsApp.
 *
 * `https://wa.me/<número>` exige el número en formato internacional, sin `+`,
 * sin espacios ni guiones: los móviles paraguayos `0981 123 456` se convierten
 * en `595981123456`. El mensaje viaja en `?text=` codificado.
 */

export const CLINIC_NAME = 'AD Clinic'

const REMINDER_DATE = new Intl.DateTimeFormat('es-PY', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

/**
 * Teléfono local/internacional → número de WhatsApp.
 *
 * Devuelve `null` si no hay dígitos suficientes: un enlace a un número truncado
 * abre un chat inexistente.
 */
export function toWhatsAppNumber(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D+/g, '')

  if (!digits) return null

  // Ya viene con código de país (`+595 981 123 456`).
  if (digits.startsWith('595')) return digits.length >= 11 ? digits : null

  // Móvil con el 0 inicial (`0981 123 456` → 10 dígitos).
  if (digits.startsWith('0')) return digits.length >= 9 ? `595${digits.slice(1)}` : null

  // Móvil sin el 0 (`981 123 456`).
  if (digits.startsWith('9')) return digits.length >= 9 ? `595${digits}` : null

  // Fijo de Asunción (`021 123 456` → 9 dígitos) u otros internos.
  return digits.length >= 8 ? `595${digits}` : null
}

/** Teléfono principal y, si no sirve, el alternativo. */
export function getReminderNumber(patient: AppointmentPatient | null): string | null {
  if (!patient) return null

  return toWhatsAppNumber(patient.phone) ?? toWhatsAppNumber(patient.phone_alt)
}

/** `jueves 29 de octubre` (hora local). */
export function formatReminderDate(startsAt: string): string {
  const date = new Date(startsAt)

  if (Number.isNaN(date.getTime())) return '—'

  return REMINDER_DATE.format(date)
}

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
