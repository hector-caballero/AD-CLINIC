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
  | 'reschedule_requested'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'no_show'

/**
 * Respuesta del paciente al recordatorio de WhatsApp: «1» confirma y «2» pide
 * reagendar. La carga el webhook de Evolution API
 * (`supabase/functions/whatsapp-webhook`), nunca la interfaz.
 */
export type PatientResponse = 'confirm' | 'reschedule'

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
  /** Última respuesta del paciente por WhatsApp (la escribe el webhook). */
  patient_response: PatientResponse | null
  patient_response_at: string | null
  reschedule_requested_at: string | null
  /** Consultorio / box donde se atiende (`Box 1`, `Consultorio 2`…). */
  room: string | null
  /** Última llamada a sala: la escribe la acción «Llamar a sala». */
  called_at: string | null
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
  /** Odontólogo responsable (opcional: se elige del directorio del equipo). */
  dentist_id: string | null
  starts_at: string
  ends_at: string
  reason: string
  notes: string | null
  /** Consultorio / box donde se atiende (opcional). */
  room: string | null
}

/** Valores del formulario: todo texto, porque los inputs no manejan `null`. */
export type AppointmentFormValues = {
  patient_id: string
  dentist_id: string
  date: string
  start_time: string
  end_time: string
  reason: string
  notes: string
  room: string
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
  'patient_response',
  'patient_response_at',
  'reschedule_requested_at',
  'room',
  'called_at',
  'created_at',
  'updated_at',
  `patient:patients(${PATIENT_EMBED})`,
].join(', ')

/**
 * Mismo select sin las columnas de la pantalla de sala (`room`, `called_at`).
 *
 * Es la red de seguridad mientras la migración
 * `20261110100000_waiting_room_display.sql` no esté aplicada: PostgREST
 * responde `42703`/`PGRST204` y tanto `/tv` como la agenda reintentan con este
 * select en lugar de quedar en blanco (leer el día es el camino crítico).
 * Guardar una cita o llamar a sala sí falla: ahí el error se muestra con el
 * mensaje que traduce `appointment-errors.ts`.
 */
export const APPOINTMENT_SELECT_LEGACY = [
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
  'patient_response',
  'patient_response_at',
  'reschedule_requested_at',
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
  reschedule_requested: {
    label: 'Reagendar',
    badge: 'bg-amber-50 text-amber-800 ring-amber-200',
    accent: 'bg-amber-500',
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
export const ACTIVE_STATUSES: AppointmentStatus[] = [
  'scheduled',
  'confirmed',
  'reschedule_requested',
  'checked_in',
]

/** Cómo se muestra en la agenda la respuesta que dio el paciente por WhatsApp. */
export const PATIENT_RESPONSE_META: Record<
  PatientResponse,
  { label: string; badge: string; icon: string }
> = {
  confirm: {
    label: 'Confirmó por WhatsApp',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    icon: 'text-emerald-600',
  },
  reschedule: {
    label: 'Pidió reagendar por WhatsApp',
    badge: 'bg-amber-50 text-amber-800 ring-amber-200',
    icon: 'text-amber-600',
  },
}

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
  // El paciente respondió «2»: recepción lo llama, reprograma con el lápiz
  // (eso devuelve la cita a `scheduled`) o decide mantener el horario.
  reschedule_requested: [
    { status: 'confirmed', label: 'Mantener', tone: 'primary' },
    { status: 'completed', label: 'Atendida', tone: 'neutral' },
    { status: 'no_show', label: 'No asistió', tone: 'neutral' },
  ],
  completed: [{ status: 'confirmed', label: 'Reabrir', tone: 'neutral' }],
  cancelled: [{ status: 'scheduled', label: 'Reabrir', tone: 'neutral' }],
  no_show: [{ status: 'scheduled', label: 'Reabrir', tone: 'neutral' }],
}

/** Estados en los que tiene sentido cancelar la cita. */
export function canCancel(status: AppointmentStatus): boolean {
  return (
    status === 'scheduled' ||
    status === 'confirmed' ||
    status === 'reschedule_requested' ||
    status === 'checked_in'
  )
}

/**
 * Estados desde los que se puede llamar al paciente a la sala.
 *
 * - `checked_in`: ya está en recepción, la llamada solo marca `called_at`.
 * - `scheduled` / `confirmed`: recepción lo llama y la misma acción lo deja en
 *   `checked_in` (si no estaba marcado, igual aparece en el turnero).
 * - `reschedule_requested` queda afuera a propósito: el paciente pidió mover la
 *   cita, hay que hablar con él antes de llamarlo a consultorio.
 */
export const CALLABLE_STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed', 'checked_in']

export function canCallToRoom(status: AppointmentStatus): boolean {
  return CALLABLE_STATUSES.includes(status)
}

/** `Box 1` → `Box 1`; texto vacío → `null` (la columna es opcional). */
export function normalizeRoom(room: string | null | undefined): string | null {
  const value = room?.trim()

  return value ? value : null
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
