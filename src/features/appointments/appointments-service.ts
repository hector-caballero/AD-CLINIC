import { supabase } from '../../lib/supabase'
import { toAppointmentError } from './appointment-errors'
import { buildAgendaRange } from './appointment-dates'
import { buildStatusPatch, buildRescheduleResetPatch } from './appointment-patch'
import {
  APPOINTMENT_SELECT,
  compareAppointments,
  type AppointmentInput,
  type AppointmentPatient,
  type AppointmentStatus,
  type AppointmentWithPatient,
} from './appointment-types'

/**
 * Acceso a `public.appointments`.
 *
 * - Siempre se consulta por rango de `starts_at` (índice `appointments_starts_at_idx`).
 * - El listado trae el paciente embebido (`patient:patients(...)`) para mostrar
 *   nombre y teléfono, y para armar el recordatorio de WhatsApp.
 * - El estado se cambia con acciones puntuales que además completan las marcas
 *   de tiempo (`checked_in_at`, `completed_at`, `cancellation_reason`).
 */

/** Tope de filas por consulta de agenda (7 días suelen ser unas pocas decenas). */
export const AGENDA_PAGE_SIZE = 500

/**
 * El cliente se crea sin la interfaz `Database`, así que un `select` dinámico
 * devuelve `GenericStringError`. Estas conversiones documentan la fila real.
 */
function asAppointments(data: unknown): AppointmentWithPatient[] {
  return (data ?? []) as AppointmentWithPatient[]
}

function asAppointment(data: unknown): AppointmentWithPatient {
  return data as AppointmentWithPatient
}

/**
 * PostgREST devuelve la relación como objeto (FK `patient_id`), pero se tolera
 * el formato de arreglo para no romper la agenda si cambia el `select`.
 */
function normalizeAppointment(row: AppointmentWithPatient): AppointmentWithPatient {
  const embedded = row.patient as AppointmentPatient | AppointmentPatient[] | null

  return {
    ...row,
    patient: Array.isArray(embedded) ? (embedded[0] ?? null) : embedded,
  }
}

export async function fetchAppointments(
  fromIso: string,
  toIso: string,
): Promise<AppointmentWithPatient[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select(APPOINTMENT_SELECT)
    .gte('starts_at', fromIso)
    .lt('starts_at', toIso)
    .order('starts_at', { ascending: true })
    .limit(AGENDA_PAGE_SIZE)

  if (error) throw toAppointmentError(error)

  return asAppointments(data).map(normalizeAppointment).sort(compareAppointments)
}

/** Citas de un día completo (se usa para avisar solapamientos al agendar). */
export function fetchAppointmentsForDay(dateKey: string): Promise<AppointmentWithPatient[]> {
  const range = buildAgendaRange('day', dateKey)

  return fetchAppointments(range.startIso, range.endIso)
}

export async function createAppointment(input: AppointmentInput): Promise<AppointmentWithPatient> {
  const { data, error } = await supabase
    .from('appointments')
    .insert({ ...input, status: 'scheduled' satisfies AppointmentStatus })
    .select(APPOINTMENT_SELECT)
    .single()

  if (error) throw toAppointmentError(error)
  if (!data) throw new Error('Supabase no devolvió la cita creada. Recargá la agenda.')

  return normalizeAppointment(asAppointment(data))
}

/**
 * Edita horario/motivo/notas sin tocar el estado (eso lo hacen las acciones).
 *
 * `resetRescheduleRequest` devuelve la cita a `scheduled` cuando recepción
 * reprograma una cita que el paciente había pedido mover por WhatsApp: el pedido
 * queda resuelto y el recordatorio se puede volver a enviar.
 */
export async function updateAppointment(
  id: string,
  input: AppointmentInput,
  options: { resetRescheduleRequest?: boolean } = {},
): Promise<AppointmentWithPatient> {
  const payload = options.resetRescheduleRequest
    ? { ...input, ...buildRescheduleResetPatch() }
    : input

  const { data, error } = await supabase
    .from('appointments')
    .update(payload)
    .eq('id', id)
    .select(APPOINTMENT_SELECT)
    .single()

  if (error) throw toAppointmentError(error)
  if (!data) throw new Error('La cita ya no existe. Recargá la agenda.')

  return normalizeAppointment(asAppointment(data))
}

export async function updateAppointmentStatus(
  id: string,
  status: AppointmentStatus,
  options: { cancellationReason?: string } = {},
): Promise<AppointmentWithPatient> {
  const { data, error } = await supabase
    .from('appointments')
    .update(buildStatusPatch(status, options))
    .eq('id', id)
    .select(APPOINTMENT_SELECT)
    .single()

  if (error) throw toAppointmentError(error)
  if (!data) throw new Error('La cita ya no existe. Recargá la agenda.')

  return normalizeAppointment(asAppointment(data))
}

/** Registra que se abrió WhatsApp con el recordatorio (auditoría simple). */
export async function markReminderSent(id: string): Promise<void> {
  const { error } = await supabase
    .from('appointments')
    .update({ reminder_sent_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw toAppointmentError(error)
}
