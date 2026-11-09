import {
  BadgeCheck,
  Ban,
  CheckCheck,
  Loader2,
  LogIn,
  MessageCircle,
  MessageCircleMore,
  Pencil,
  RotateCcw,
  ShieldAlert,
  UserX,
} from 'lucide-react'
import { formatPatientDocument, formatPhonePY } from '../../lib/format'
import {
  formatAppointmentTime,
  formatDuration,
  isPastAppointment,
  minutesBetween,
  type AgendaDayGroup,
} from './appointment-dates'
import {
  ACTIVE_STATUSES,
  APPOINTMENT_ACTIONS,
  APPOINTMENT_STATUS_META,
  canCancel,
  getAppointmentPatientName,
  type AppointmentStatus,
  type AppointmentWithPatient,
} from './appointment-types'
import { getReminderNumber } from './appointment-whatsapp'

type AgendaListProps = {
  groups: AgendaDayGroup[]
  /** Cita con una actualización en curso (bloquea sus botones). */
  pendingId: string | null
  /** Cita cuyo recordatorio está viajando a Evolution API. */
  reminderPendingId: string | null
  onEdit: (appointment: AppointmentWithPatient) => void
  onStatusChange: (appointment: AppointmentWithPatient, status: AppointmentStatus) => void
  onCancel: (appointment: AppointmentWithPatient) => void
  /** Abre WhatsApp Web/App con el mensaje ya escrito (envío manual). */
  onWhatsApp: (appointment: AppointmentWithPatient) => void
  /** Envía el recordatorio automático por Evolution API. */
  onSendReminder: (appointment: AppointmentWithPatient) => void
}

const ACTION_ICONS: Record<AppointmentStatus, typeof RotateCcw> = {
  confirmed: BadgeCheck,
  checked_in: LogIn,
  completed: CheckCheck,
  no_show: UserX,
  scheduled: RotateCcw,
  cancelled: Ban,
}

const ACTION_TONES = {
  primary:
    'bg-brand-500 text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-70',
  neutral:
    'border border-slate-300 bg-white/85 text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50',
} as const

/** Citas agrupadas por día, con acciones rápidas y recordatorio de WhatsApp. */
export function AgendaList({
  groups,
  pendingId,
  reminderPendingId,
  onEdit,
  onStatusChange,
  onCancel,
  onWhatsApp,
  onSendReminder,
}: AgendaListProps) {
  return (
    <div className="divide-y divide-slate-200">
      {groups.map((group) => (
        <section key={group.dateKey} aria-label={group.label}>
          <header className="flex items-center justify-between gap-2 bg-slate-50/80 px-4 py-2 sm:px-5">
            <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              {group.context && (
                <span className="rounded bg-brand-600/10 px-1.5 py-0.5 text-[10px] font-bold text-brand-700">
                  {group.context}
                </span>
              )}
              {group.label}
            </h2>
            <span className="text-xs tabular-nums text-slate-400">
              {group.appointments.length} {group.appointments.length === 1 ? 'cita' : 'citas'}
            </span>
          </header>

          {group.appointments.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400 sm:px-5">Sin citas agendadas.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {group.appointments.map((appointment) => (
                <AppointmentRow
                  key={appointment.id}
                  appointment={appointment}
                  isPending={pendingId === appointment.id}
                  isReminding={reminderPendingId === appointment.id}
                  onEdit={onEdit}
                  onStatusChange={onStatusChange}
                  onCancel={onCancel}
                  onWhatsApp={onWhatsApp}
                  onSendReminder={onSendReminder}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

type AppointmentRowProps = Omit<
  AgendaListProps,
  'groups' | 'pendingId' | 'reminderPendingId'
> & {
  appointment: AppointmentWithPatient
  isPending: boolean
  /** El recordatorio de WhatsApp está viajando a Evolution API. */
  isReminding: boolean
}

function AppointmentRow({
  appointment,
  isPending,
  isReminding,
  onEdit,
  onStatusChange,
  onCancel,
  onWhatsApp,
  onSendReminder,
}: AppointmentRowProps) {
  const meta = APPOINTMENT_STATUS_META[appointment.status]
  const actions = APPOINTMENT_ACTIONS[appointment.status]
  const patient = appointment.patient
  const patientName = getAppointmentPatientName(appointment)
  const start = formatAppointmentTime(appointment.starts_at)
  const end = formatAppointmentTime(appointment.ends_at)
  const duration = minutesBetween(appointment.starts_at, appointment.ends_at)
  const allergies = (patient?.allergies ?? []).filter(Boolean)
  const hasReminderPhone = getReminderNumber(patient) !== null
  const isOverdue = ACTIVE_STATUSES.includes(appointment.status) && isPastAppointment(appointment)
  const isClosed = appointment.status === 'cancelled' || appointment.status === 'no_show'
  /** Recordar solo tiene sentido mientras el paciente todavía debe venir. */
  const isRemindable =
    appointment.status === 'scheduled' || appointment.status === 'confirmed'
  const canRemind = hasReminderPhone && isRemindable
  const remindTitle = !hasReminderPhone
    ? 'El paciente no tiene un teléfono válido para WhatsApp'
    : isRemindable
      ? 'Enviar el recordatorio por WhatsApp desde el número de la clínica'
      : 'La cita ya no está pendiente: solo se recuerdan citas programadas o confirmadas'

  return (
    <li
      aria-busy={isPending}
      className={[
        'relative flex flex-col gap-3 py-4 pl-5 pr-4 sm:pr-5 md:flex-row md:items-start',
        isClosed ? 'bg-slate-50/40' : '',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-3 left-0 w-1 rounded-r-full ${meta.accent}`}
      />

      <div className="md:w-28 md:shrink-0">
        <p className="text-sm font-semibold tabular-nums text-slate-900">{start}</p>
        <p className="text-xs tabular-nums text-slate-400">hasta {end}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">{formatDuration(duration)}</p>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-slate-900">{patientName}</p>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${meta.badge}`}
          >
            {meta.label}
          </span>
          {isOverdue && (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">
              Vencida
            </span>
          )}
        </div>

        <p className="mt-0.5 text-sm text-slate-600">{appointment.reason}</p>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          {patient?.phone && <span className="tabular-nums">{formatPhonePY(patient.phone)}</span>}
          {patient?.document_number && (
            <span>{formatPatientDocument(patient.document_type, patient.document_number)}</span>
          )}
          {allergies.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700 ring-1 ring-rose-200">
              <ShieldAlert className="size-3" aria-hidden="true" />
              Alergias: {allergies.join(', ')}
            </span>
          )}
        </div>

        {appointment.notes && (
          <p className="mt-1 text-xs leading-relaxed text-slate-500">Nota: {appointment.notes}</p>
        )}
        {appointment.status === 'cancelled' && appointment.cancellation_reason && (
          <p className="mt-1 text-xs text-rose-600">
            Motivo de cancelación: {appointment.cancellation_reason}
          </p>
        )}
        {appointment.reminder_sent_at && (
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
            <BadgeCheck className="size-3" aria-hidden="true" />
            Recordatorio de WhatsApp enviado a las{' '}
            {formatAppointmentTime(appointment.reminder_sent_at)}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 md:items-end">
        <div className="flex flex-wrap items-center gap-1.5">
          {actions.map((action) => {
            const Icon = ACTION_ICONS[action.status]

            return (
              <button
                key={action.status}
                type="button"
                disabled={isPending}
                onClick={() => onStatusChange(appointment, action.status)}
                aria-label={`${action.label}: ${patientName} a las ${start}`}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${ACTION_TONES[action.tone]}`}
              >
                {isPending ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Icon className="size-3.5" aria-hidden="true" />
                )}
                {action.label}
              </button>
            )
          })}

          {canCancel(appointment.status) && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => onCancel(appointment)}
              aria-label={`Cancelar la cita de ${patientName} a las ${start}`}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white/85 px-2.5 py-1 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Ban className="size-3.5" aria-hidden="true" />
              Cancelar
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSendReminder(appointment)}
            disabled={!canRemind || isReminding || isPending}
            title={remindTitle}
            aria-label={`Enviar recordatorio por WhatsApp a ${patientName} para la cita de las ${start}`}
            aria-busy={isReminding}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
          >
            {isReminding ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <MessageCircle className="size-3.5" aria-hidden="true" />
            )}
            {isReminding ? 'Enviando…' : 'Recordar'}
          </button>

          <button
            type="button"
            onClick={() => onWhatsApp(appointment)}
            disabled={!canRemind}
            title={
              canRemind
                ? 'Abrir WhatsApp Web con el mensaje escrito (envío manual)'
                : remindTitle
            }
            aria-label={`Abrir WhatsApp con el recordatorio de ${patientName}`}
            className="rounded-lg border border-slate-300 bg-white/85 p-1.5 text-emerald-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            <MessageCircleMore className="size-3.5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => onEdit(appointment)}
            aria-label={`Editar la cita de ${patientName} a las ${start}`}
            className="rounded-lg border border-slate-300 bg-white/85 p-1.5 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
          >
            <Pencil className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </li>
  )
}
