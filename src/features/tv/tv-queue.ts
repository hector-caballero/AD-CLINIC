import { formatAppointmentTime } from '../appointments/appointment-dates'
import { getAppointmentPatientName, type AppointmentWithPatient } from '../appointments/appointment-types'
import type { StaffNameMap } from '../team/staff-directory'
import {
  TV_ATTENDED_LIMIT,
  getWaitingRoomPhase,
  type WaitingRoomEntry,
  type WaitingRoomSnapshot,
} from './tv-types'

/**
 * Armado del estado de la sala (lógica pura, sin React ni Supabase).
 *
 * - «Llamada vigente»: la cita con `called_at` más reciente de las que están en
 *   sala. Si esa llamada es vieja (`in_progress`) se sigue mostrando, pero el
 *   componente ya no la pinta con pulso.
 * - «En espera»: `checked_in` sin llamar, ordenados por horario de la cita.
 * - «En consultorio»: llamadas que ya superaron la ventana de la fase `calling`.
 * - «Atendidos»: `completed`, por `completed_at` descendente.
 */

function toTimestamp(value: string | null): number {
  if (!value) return 0

  const time = new Date(value).getTime()

  return Number.isNaN(time) ? 0 : time
}

function minutesSince(value: string | null, now: Date): number {
  const time = toTimestamp(value)

  if (!time) return 0

  return Math.max(0, Math.floor((now.getTime() - time) / 60_000))
}

function buildEntry(
  appointment: AppointmentWithPatient,
  staffNames: StaffNameMap,
  now: Date,
): WaitingRoomEntry {
  const dentistName = appointment.dentist_id
    ? (staffNames[appointment.dentist_id] ?? null)
    : null

  return {
    appointment,
    patientName: getAppointmentPatientName(appointment),
    phase: getWaitingRoomPhase(appointment, now),
    dentistName,
    room: appointment.room ?? null,
    minutesWaiting: minutesSince(appointment.checked_in_at ?? appointment.starts_at, now),
    calledAtTime: appointment.called_at ? formatAppointmentTime(appointment.called_at) : null,
  }
}

/** `true` si el turnero debe conocer esta cita (misma lógica que la consulta). */
export function isWaitingRoomAppointment(
  appointment: Pick<AppointmentWithPatient, 'status'>,
): boolean {
  return appointment.status === 'checked_in' || appointment.status === 'completed'
}

export function buildWaitingRoomSnapshot(
  appointments: AppointmentWithPatient[],
  options: { staffNames?: StaffNameMap; now?: Date } = {},
): WaitingRoomSnapshot {
  const staffNames = options.staffNames ?? {}
  const now = options.now ?? new Date()

  const inRoom = appointments
    .filter((appointment) => appointment.status === 'checked_in')
    .map((appointment) => buildEntry(appointment, staffNames, now))

  // La llamada vigente es la más reciente; se desempata por id para que dos
  // llamadas del mismo segundo no salten de tarjeta entre renders.
  const current =
    inRoom
      .filter((entry) => entry.appointment.called_at !== null)
      .sort((a, b) => {
        const byCall =
          toTimestamp(b.appointment.called_at) - toTimestamp(a.appointment.called_at)

        return byCall !== 0 ? byCall : a.appointment.id.localeCompare(b.appointment.id)
      })[0] ?? null

  const waiting = inRoom
    .filter((entry) => entry.appointment.called_at === null)
    .sort((a, b) => {
      const byStart = a.appointment.starts_at.localeCompare(b.appointment.starts_at)

      return byStart !== 0 ? byStart : a.appointment.id.localeCompare(b.appointment.id)
    })

  const inProgress = inRoom
    .filter(
      (entry) =>
        entry.appointment.called_at !== null &&
        entry.phase === 'in_progress' &&
        entry.appointment.id !== current?.appointment.id,
    )
    .sort((a, b) => toTimestamp(a.appointment.called_at) - toTimestamp(b.appointment.called_at))

  const attended = appointments
    .filter((appointment) => appointment.status === 'completed')
    .sort((a, b) => toTimestamp(b.completed_at) - toTimestamp(a.completed_at))
    .slice(0, TV_ATTENDED_LIMIT)
    .map((appointment) => buildEntry(appointment, staffNames, now))

  return {
    current,
    waiting,
    inProgress,
    attended,
    inRoom: waiting.length + inProgress.length + (current ? 1 : 0),
  }
}
