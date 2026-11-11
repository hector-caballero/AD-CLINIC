import type { Appointment, AppointmentWithPatient } from '../appointments/appointment-types'

/**
 * Tipos del turnero (pantalla de sala `/tv`).
 *
 * La base no tiene estados `waiting` / `calling` / `in_progress`: el estado real
 * de la cita es `appointment_status` y la llamada a sala se guarda como marca de
 * tiempo (`called_at`). El turnero **deriva** sus tres fases de esos dos datos,
 * así la agenda sigue teniendo una sola fuente de verdad:
 *
 * | Fase          | Condición                                        |
 * | ------------- | ------------------------------------------------ |
 * | `waiting`     | `status = 'checked_in'` y `called_at` vacío      |
 * | `calling`     | `status = 'checked_in'` y llamada hace < 10 min  |
 * | `in_progress` | `status = 'checked_in'` y llamada hace ≥ 10 min  |
 *
 * Los `completed` del día son los «últimos atendidos».
 */

/** Fase del paciente en la sala. */
export type WaitingRoomPhase = 'waiting' | 'calling' | 'in_progress'

/**
 * Minutos que una llamada se muestra como «llamando» (tarjeta con pulso).
 * Pasado ese tiempo el paciente se considera adentro del consultorio.
 */
export const TV_CALL_WINDOW_MINUTES = 10

/** Cuántos pacientes en espera entran en el panel lateral. */
export const TV_WAITING_LIMIT = 6

/** Cuántos atendidos se listan abajo. */
export const TV_ATTENDED_LIMIT = 4

/** Refresco de respaldo por si el canal de Realtime se cae sin avisar. */
export const TV_REFRESH_INTERVAL_MS = 5 * 60 * 1000

/** Los eventos de Realtime llegan en ráfaga: se agrupan antes de reconsultar. */
export const TV_EVENT_DEBOUNCE_MS = 250

/** Cita del día preparada para mostrarse en la tele. */
export type WaitingRoomEntry = {
  appointment: AppointmentWithPatient
  /** Nombre completo del paciente. */
  patientName: string
  /** `null` cuando la cita no está en sala (p. ej. ya atendida). */
  phase: WaitingRoomPhase | null
  /** Profesional asignado, si la cita tiene `dentist_id` y hay directorio. */
  dentistName: string | null
  /** Consultorio / box. */
  room: string | null
  /** Minutos desde el check-in (o desde la hora de la cita si no hay check-in). */
  minutesWaiting: number
  /** `10:12` de la última llamada, o `null`. */
  calledAtTime: string | null
}

/** Estado completo de la sala en un instante. */
export type WaitingRoomSnapshot = {
  /** Llamada vigente: la más reciente de la sala (con o sin pulso). */
  current: WaitingRoomEntry | null
  /** En sala, sin llamar todavía, en orden de horario. */
  waiting: WaitingRoomEntry[]
  /** Llamados hace rato: ya están en el consultorio. */
  inProgress: WaitingRoomEntry[]
  /** Últimos atendidos del día (más reciente primero). */
  attended: WaitingRoomEntry[]
  /** Personas en la sala (esperando + en consultorio + la llamada vigente). */
  inRoom: number
}

export const TV_PHASE_META: Record<WaitingRoomPhase, { label: string; caption: string }> = {
  waiting: { label: 'En espera', caption: 'Esperando su turno' },
  calling: { label: 'Llamando', caption: 'Pasar a consultorio' },
  in_progress: { label: 'En consultorio', caption: 'Siendo atendido' },
}

/**
 * Fase del turnero para una cita.
 * Devuelve `null` si la cita no está en sala (programada, atendida, cancelada…).
 */
export function getWaitingRoomPhase(
  appointment: Pick<Appointment, 'status' | 'called_at'>,
  now: Date = new Date(),
): WaitingRoomPhase | null {
  if (appointment.status !== 'checked_in') return null

  if (!appointment.called_at) return 'waiting'

  const calledAt = new Date(appointment.called_at).getTime()

  if (Number.isNaN(calledAt)) return 'waiting'

  const minutes = (now.getTime() - calledAt) / 60_000

  return minutes < TV_CALL_WINDOW_MINUTES ? 'calling' : 'in_progress'
}

/** Estados que el turnero consulta (en sala + atendidas del día). */
export const TV_APPOINTMENT_STATUSES = ['checked_in', 'completed'] as const
