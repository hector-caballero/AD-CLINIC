import { supabase } from '../../lib/supabase'
import {
  getAppointmentErrorMessage,
  isMissingWaitingRoomColumn,
} from '../appointments/appointment-errors'
import {
  APPOINTMENT_SELECT,
  APPOINTMENT_SELECT_LEGACY,
  type AppointmentPatient,
  type AppointmentWithPatient,
} from '../appointments/appointment-types'
import {
  fetchStaffDirectory,
  toStaffNameMap,
  type StaffNameMap,
} from '../team/staff-directory'
import { TV_APPOINTMENT_STATUSES } from './tv-types'

/**
 * Lectura de la sala de espera.
 *
 * Solo se piden las citas del día con estado `checked_in` (en sala) o
 * `completed` (atendidas), que son las que la tele muestra. La consulta se
 * resuelve por rango de `starts_at`, igual que la agenda.
 */

/** El turnero de un día no pasa de unas pocas decenas de filas. */
const TV_PAGE_SIZE = 200

export type WaitingRoomFetchResult = {
  appointments: AppointmentWithPatient[]
  /**
   * `true` cuando la base todavía no tiene `room` / `called_at` (migración de
   * sala pendiente) y hubo que consultar con el select viejo. La pantalla avisa
   * en lugar de romperse.
   */
  needsMigration: boolean
}

/** Igual que la agenda: se tolera el embed como arreglo y se normaliza. */
function normalizeAppointment(row: AppointmentWithPatient): AppointmentWithPatient {
  const embedded = row.patient as AppointmentPatient | AppointmentPatient[] | null

  return {
    ...row,
    patient: Array.isArray(embedded) ? (embedded[0] ?? null) : embedded,
    room: row.room ?? null,
    called_at: row.called_at ?? null,
  }
}

function asAppointments(data: unknown): AppointmentWithPatient[] {
  return (data ?? []) as AppointmentWithPatient[]
}

function queryDay(select: string, fromIso: string, toIso: string) {
  return supabase
    .from('appointments')
    .select(select)
    .in('status', [...TV_APPOINTMENT_STATUSES])
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)
    .order('starts_at', { ascending: true })
    .limit(TV_PAGE_SIZE)
}

export async function fetchWaitingRoomAppointments(
  fromIso: string,
  toIso: string,
): Promise<WaitingRoomFetchResult> {
  const { data, error } = await queryDay(APPOINTMENT_SELECT, fromIso, toIso)

  if (!error) {
    return { appointments: asAppointments(data).map(normalizeAppointment), needsMigration: false }
  }

  if (!isMissingWaitingRoomColumn(error)) throw new Error(getAppointmentErrorMessage(error))

  const fallback = await queryDay(APPOINTMENT_SELECT_LEGACY, fromIso, toIso)

  if (fallback.error) throw new Error(getAppointmentErrorMessage(fallback.error))

  return {
    appointments: asAppointments(fallback.data).map(normalizeAppointment),
    needsMigration: true,
  }
}

/**
 * Directorio del equipo (`staff_directory`) como mapa `id → nombre`.
 * Si la vista todavía no existe, el turnero sigue funcionando sin profesional.
 */
export async function fetchWaitingRoomStaff(): Promise<StaffNameMap> {
  const entries = await fetchStaffDirectory()

  return toStaffNameMap(entries)
}
