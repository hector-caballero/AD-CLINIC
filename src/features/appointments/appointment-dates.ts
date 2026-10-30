import type { Appointment, AppointmentView, AppointmentWithPatient } from './appointment-types'
import { compareAppointments } from './appointment-types'

/**
 * Fechas y horarios de la agenda.
 *
 * `starts_at`/`ends_at` son `timestamptz`: se guardan como instantes ISO y se
 * muestran en la hora local. Para las claves de día (`2026-10-29`) se arman a
 * mano en lugar de usar `toISOString()`, que cambia de día según la zona.
 */

/** Duración máxima aceptada por la base (`appointments_max_duration_check`). */
export const MAX_APPOINTMENT_MINUTES = 8 * 60

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** `Date` local → `2026-10-29`. */
export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** `2026-10-29` → `Date` a medianoche local (nunca interpreta UTC). */
export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)

  return new Date(year || 1970, (month || 1) - 1, day || 1)
}

export function todayKey(now: Date = new Date()): string {
  return toDateKey(now)
}

export function addDays(key: string, days: number): string {
  const date = parseDateKey(key)
  date.setDate(date.getDate() + days)

  return toDateKey(date)
}

/** Días calendario entre dos claves (`29` → `31` = 2). */
export function diffInDays(fromKey: string, toKey: string): number {
  return Math.round((parseDateKey(toKey).getTime() - parseDateKey(fromKey).getTime()) / 86_400_000)
}

export type AgendaRange = {
  /** Primer día visible (`2026-10-29`). */
  from: string
  /** Último día visible. */
  to: string
  /** Inicio del rango como instante ISO (medianoche local). */
  startIso: string
  /** Fin exclusivo del rango (medianoche del día siguiente al último). */
  endIso: string
  /** Días visibles, en orden. */
  days: string[]
}

/** Rango a consultar: 1 día o 7 días desde `anchor`. */
export function buildAgendaRange(view: AppointmentView, anchor: string): AgendaRange {
  const dayCount = view === 'week' ? 7 : 1
  const days = Array.from({ length: dayCount }, (_, index) => addDays(anchor, index))
  const firstDay = days[0]
  const lastDay = days[days.length - 1]

  return {
    from: firstDay,
    to: lastDay,
    startIso: parseDateKey(firstDay).toISOString(),
    endIso: parseDateKey(addDays(lastDay, 1)).toISOString(),
    days,
  }
}

/** Instante ISO → `09:30` en hora local. */
export function formatAppointmentTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value

  if (Number.isNaN(date.getTime())) return '—'

  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** `2026-10-29` + `09:30` → `Date` local (o `null` si el texto no es válido). */
export function combineDateAndTime(dateKey: string, time: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim())

  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])

  if (hours > 23 || minutes > 59) return null

  const date = parseDateKey(dateKey)
  date.setHours(hours, minutes, 0, 0)

  return date
}

/** `09:30` + `45` → `10:15`. */
export function addMinutesToTime(time: string, minutes: number): string {
  const base = combineDateAndTime('2000-01-01', time)

  if (!base) return time

  base.setMinutes(base.getMinutes() + minutes)

  return formatAppointmentTime(base)
}

export function minutesBetween(startIso: string, endIso: string): number {
  const difference = new Date(endIso).getTime() - new Date(startIso).getTime()

  if (Number.isNaN(difference)) return 0

  return Math.round(difference / 60_000)
}

/** Duración legible: `45 min`, `1 h`, `1 h 30 min`. */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—'
  if (minutes < 60) return `${minutes} min`

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60

  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/** Horario sugerido al crear: la próxima media hora, o 09:00 si ya es tarde. */
export function suggestStartTime(dateKey: string, now: Date = new Date()): string {
  if (dateKey !== toDateKey(now)) return '09:00'

  const nextSlot = new Date(now)
  nextSlot.setSeconds(0, 0)

  if (now.getMinutes() >= 30) {
    nextSlot.setHours(nextSlot.getHours() + 1, 0, 0, 0)
  } else {
    nextSlot.setMinutes(30, 0, 0)
  }

  if (nextSlot.getHours() >= 21) return '09:00'

  return formatAppointmentTime(nextSlot)
}


const DAY_AND_MONTH = new Intl.DateTimeFormat('es-PY', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

const SHORT_DAY = new Intl.DateTimeFormat('es-PY', { weekday: 'short' })
const SHORT_DAY_AND_MONTH = new Intl.DateTimeFormat('es-PY', { day: 'numeric', month: 'short' })

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** `Jueves 29 de octubre`. */
export function formatDayHeading(dateKey: string): string {
  return capitalize(DAY_AND_MONTH.format(parseDateKey(dateKey)).replace(/,/g, ''))
}

/** `jue` */
export function formatWeekdayShort(dateKey: string): string {
  return SHORT_DAY.format(parseDateKey(dateKey)).replace(/\.$/, '')
}

/** `29 oct` */
export function formatDayMonthShort(dateKey: string): string {
  return SHORT_DAY_AND_MONTH.format(parseDateKey(dateKey)).replace(/\.$/, '')
}

/** `Hoy`, `Mañana`, `Ayer` o `null`. */
export function formatDayContext(dateKey: string, today: string = todayKey()): string | null {
  const difference = diffInDays(today, dateKey)

  if (difference === 0) return 'Hoy'
  if (difference === 1) return 'Mañana'
  if (difference === -1) return 'Ayer'

  return null
}

/** Título del rango visible en la barra de la agenda. */
export function formatAgendaRangeLabel(view: AppointmentView, range: AgendaRange): string {
  if (view === 'day') return formatDayHeading(range.from)

  return `${formatDayMonthShort(range.from)} – ${formatDayMonthShort(range.to)}`
}

export type AgendaDayGroup = {
  dateKey: string
  /** `Jueves 29 de octubre`. */
  label: string
  /** `Hoy` / `Mañana` / `Ayer` cuando aplica. */
  context: string | null
  appointments: AppointmentWithPatient[]
}

/** Agrupa por día local, conservando todos los días del rango (aunque vacíos). */
export function groupAppointmentsByDay(
  appointments: AppointmentWithPatient[],
  days: string[],
): AgendaDayGroup[] {
  const buckets = new Map<string, AppointmentWithPatient[]>()

  for (const day of days) buckets.set(day, [])

  for (const appointment of appointments) {
    const key = toDateKey(new Date(appointment.starts_at))
    const bucket = buckets.get(key)

    if (bucket) bucket.push(appointment)
  }

  return days.map((dateKey) => ({
    dateKey,
    label: formatDayHeading(dateKey),
    context: formatDayContext(dateKey),
    appointments: (buckets.get(dateKey) ?? []).sort(compareAppointments),
  }))
}

export type AppointmentSlot = {
  starts_at: string
  ends_at: string
}

/** Dos intervalos se solapan si cada uno empieza antes de que termine el otro. */
export function overlaps(a: AppointmentSlot, b: AppointmentSlot): boolean {
  const aStart = new Date(a.starts_at).getTime()
  const aEnd = new Date(a.ends_at).getTime()
  const bStart = new Date(b.starts_at).getTime()
  const bEnd = new Date(b.ends_at).getTime()

  return aStart < bEnd && bStart < aEnd
}

/** Citas del día que se pisan con el horario propuesto. */
export function findSlotConflicts(
  appointments: AppointmentWithPatient[],
  slot: AppointmentSlot,
  excludeId?: string,
): AppointmentWithPatient[] {
  return appointments.filter(
    (appointment) => appointment.id !== excludeId && overlaps(appointment, slot),
  )
}

/** Solapamientos del mismo paciente (más grave que compartir horario con otro). */
export function findPatientConflicts(
  appointments: AppointmentWithPatient[],
  slot: AppointmentSlot & { patient_id: string },
  excludeId?: string,
): AppointmentWithPatient[] {
  return findSlotConflicts(appointments, slot, excludeId).filter(
    (appointment) => appointment.patient_id === slot.patient_id,
  )
}

/** Cita cuya hora de fin ya pasó (para atenuarla en la agenda). */
export function isPastAppointment(appointment: Appointment, now: Date = new Date()): boolean {
  return new Date(appointment.ends_at).getTime() < now.getTime()
}
