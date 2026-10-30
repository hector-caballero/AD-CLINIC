import type { Patient } from '../patients/patient-types'

/**
 * Tipos del módulo de citas.
 *
 * La tabla `public.appointments` guarda los horarios como `timestamptz`
 * (instantes absolutos), así que la interfaz siempre los muestra en la hora
 * local del navegador. El estado usa el enum `public.appointment_status`.
 */

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'no_show'

/** Vista de la agenda: un día o los próximos 7 días desde la fecha ancla. */
export type AppointmentView = 'day' | 'week'

/** Fila de `public.appointments`. */
export type Appointment = {
  id: string
  patient_id: string
  dentist_id: string | null
  starts_at: string
  ends_at: string
  status: AppointmentStatus
  reason: string
  notes: string | null
  cancellation_reason: string | null
  checked_in_at: string | null
  completed_at: string | null
  reminder_sent_at: string | null
  created_at: string
  updated_at: string
}

/** Datos del paciente que la agenda necesita para identificar y contactar. */
export type AppointmentPatient = Pick<
  Patient,
  | 'id'
  | 'first_name'
  | 'last_name'
  | 'phone'
  | 'phone_alt'
  | 'document_type'
  | 'document_number'
  | 'allergies'
>

/** Cita con el paciente embebido por PostgREST (`patient:patients(...)`). */
export type AppointmentWithPatient = Appointment & {
  patient: AppointmentPatient | null
}

/** Payload de alta/edición (el estado se gestiona con las acciones rápidas). */
export type AppointmentInput = {
  patient_id: string
  starts_at: string
  ends_at: string
  reason: string
  notes: string | null
}

/** Valores del formulario: todo texto, porque los inputs no manejan `null`. */
export type AppointmentFormValues = {
  patient_id: string
  date: string
  start_time: string
  end_time: string
  reason: string
  notes: string
}

const PATIENT_EMBED = [
  'id',
  'first_name',
  'last_name',
  'phone',
  'phone_alt',
  'document_type',
  'document_number',
  'allergies',
].join(', ')

/** Columnas de la cita + `patient` embebido (join por `patient_id`). */
export const APPOINTMENT_SELECT = [
  'id',
  'patient_id',
  'dentist_id',
  'starts_at',
  'ends_at',
  'status',
  'reason',
  'notes',
  'cancellation_reason',
  'checked_in_at',
  'completed_at',
  'reminder_sent_at',
  'created_at',
  'updated_at',
  `patient:patients(${PATIENT_EMBED})`,
].join(', ')

type StatusMeta = {
  label: string
  /** Clases del badge (`ring-1` incluido en el componente). */
  badge: string
  /** Color de la barra lateral de la tarjeta. */
  accent: string
}

export const APPOINTMENT_STATUS_META: Record<AppointmentStatus, StatusMeta> = {
  scheduled: {
    label: 'Programada',
    badge: 'bg-sky-50 text-sky-700 ring-sky-200',
    accent: 'bg-sky-400',
  },
  confirmed: {
    label: 'Confirmada',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    accent: 'bg-emerald-500',
  },
  checked_in: {
    label: 'En sala',
    badge: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    accent: 'bg-indigo-500',
  },
  completed: {
    label: 'Atendida',
    badge: 'bg-slate-100 text-slate-600 ring-slate-200',
    accent: 'bg-slate-400',
  },
  cancelled: {
    label: 'Cancelada',
    badge: 'bg-rose-50 text-rose-700 ring-rose-200',
    accent: 'bg-rose-400',
  },
  no_show: {
    label: 'No asistió',
    badge: 'bg-amber-50 text-amber-800 ring-amber-200',
    accent: 'bg-amber-400',
  },
}

/** Estados que todavía esperan atención del odontólogo. */
export const ACTIVE_STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed', 'checked_in']

export type QuickAction = {
  status: AppointmentStatus
  label: string
  tone: 'primary' | 'neutral'
}

/**
 * Transiciones permitidas desde cada estado (sin cancelar, que pide motivo).
 * `completed` no se puede completar dos veces y las citas cerradas se reabren.
 */
export const APPOINTMENT_ACTIONS: Record<AppointmentStatus, QuickAction[]> = {
  scheduled: [
    { status: 'confirmed', label: 'Confirmar', tone: 'primary' },
    { status: 'completed', label: 'Atendida', tone: 'neutral' },
    { status: 'no_show', label: 'No asistió', tone: 'neutral' },
  ],
  confirmed: [
    { status: 'checked_in', label: 'Check-in', tone: 'primary' },
    { status: 'completed', label: 'Atendida', tone: 'neutral' },
    { status: 'no_show', label: 'No asistió', tone: 'neutral' },
  ],
  checked_in: [{ status: 'completed', label: 'Atendida', tone: 'primary' }],
  completed: [{ status: 'confirmed', label: 'Reabrir', tone: 'neutral' }],
  cancelled: [{ status: 'scheduled', label: 'Reabrir', tone: 'neutral' }],
  no_show: [{ status: 'scheduled', label: 'Reabrir', tone: 'neutral' }],
}

/** Estados en los que tiene sentido cancelar la cita. */
export function canCancel(status: AppointmentStatus): boolean {
  return status === 'scheduled' || status === 'confirmed' || status === 'checked_in'
}

export function getAppointmentPatientName(appointment: AppointmentWithPatient): string {
  const patient = appointment.patient

  if (!patient) return 'Paciente sin datos'

  return `${patient.first_name} ${patient.last_name}`.replace(/\s+/g, ' ').trim()
}

/** Orden cronológico (y desempate estable por id). */
export function compareAppointments(
  a: Pick<Appointment, 'starts_at' | 'ends_at' | 'id'>,
  b: Pick<Appointment, 'starts_at' | 'ends_at' | 'id'>,
): number {
  const byStart = a.starts_at.localeCompare(b.starts_at)

  if (byStart !== 0) return byStart

  const byEnd = a.ends_at.localeCompare(b.ends_at)

  return byEnd !== 0 ? byEnd : a.id.localeCompare(b.id)
}
