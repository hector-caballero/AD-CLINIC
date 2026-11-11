import { useMemo, useState } from 'react'
import { AlertCircle, CalendarPlus, CalendarX2, Loader2, RefreshCw, X } from 'lucide-react'
import { AgendaList } from '../features/appointments/AgendaList'
import { AgendaToolbar } from '../features/appointments/AgendaToolbar'
import { AppointmentFormModal } from '../features/appointments/AppointmentFormModal'
import { CancelAppointmentDialog } from '../features/appointments/CancelAppointmentDialog'
import {
  addDays,
  buildAgendaRange,
  formatAgendaRangeLabel,
  formatAppointmentTime,
  formatDayHeading,
  groupAppointmentsByDay,
  toDateKey,
  todayKey,
} from '../features/appointments/appointment-dates'
import {
  APPOINTMENT_STATUS_META,
  getAppointmentPatientName,
  type AppointmentStatus,
  type AppointmentView,
  type AppointmentWithPatient,
} from '../features/appointments/appointment-types'
import {
  callAppointmentToRoom,
  markReminderSent,
  updateAppointmentStatus,
} from '../features/appointments/appointments-service'
import { buildReminderUrl } from '../features/appointments/appointment-whatsapp'
import { useAppointments } from '../features/appointments/useAppointments'
import { usePatients } from '../features/patients/usePatients'
import { formatPhonePY } from '../lib/format'
import { getWhatsAppStatus, sendAppointmentReminder } from '../services/whatsapp'

type FormState =
  | { mode: 'create'; date: string }
  | { mode: 'edit'; appointment: AppointmentWithPatient }
  | null

const PRIMARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400'

/**
 * Agenda de la clínica.
 *
 * - Vista de un día o de los próximos 7 días, con navegación por fecha.
 * - Alta/edición de citas con paciente ya registrado y aviso de solapamientos.
 * - Acciones rápidas de estado y recordatorio por WhatsApp.
 * - Los datos salen de `appointments` con el paciente embebido por PostgREST.
 */
export default function AppointmentsPage() {
  const [view, setView] = useState<AppointmentView>('day')
  const [anchor, setAnchor] = useState(() => todayKey())

  const range = useMemo(() => buildAgendaRange(view, anchor), [view, anchor])

  const { appointments, isLoading, error, reload, applyAppointment, patchAppointment } =
    useAppointments({ fromIso: range.startIso, toIso: range.endIso })
  const { patients, error: patientsError, reload: reloadPatients } = usePatients()

  const [formState, setFormState] = useState<FormState>(null)
  const [cancelTarget, setCancelTarget] = useState<AppointmentWithPatient | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  /** Cita cuyo recordatorio está viajando a Evolution API. */
  const [reminderPendingId, setReminderPendingId] = useState<string | null>(null)
  /** Cita cuya llamada a sala está viajando a Supabase. */
  const [callingId, setCallingId] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const summary = useMemo(
    () => ({
      total: appointments.length,
      pending: appointments.filter(
        (appointment) =>
          appointment.status === 'scheduled' ||
          appointment.status === 'confirmed' ||
          appointment.status === 'reschedule_requested',
      ).length,
      completed: appointments.filter((appointment) => appointment.status === 'completed').length,
      cancelled: appointments.filter(
        (appointment) => appointment.status === 'cancelled' || appointment.status === 'no_show',
      ).length,
    }),
    [appointments],
  )

  const groups = useMemo(
    () => groupAppointmentsByDay(appointments, range.days),
    [appointments, range.days],
  )

  const rangeLabel = useMemo(() => formatAgendaRangeLabel(view, range), [view, range])


  function clearMessages() {
    setNotice(null)
    setActionError(null)
  }

  function handleViewChange(nextView: AppointmentView) {
    clearMessages()
    setView(nextView)
  }

  function shiftAnchor(days: number) {
    clearMessages()
    setAnchor((current) => addDays(current, days))
  }

  function goToToday() {
    clearMessages()
    setAnchor(todayKey())
    setView('day')
  }

  function openCreate() {
    clearMessages()
    setFormState({ mode: 'create', date: anchor })
  }

  function openEdit(appointment: AppointmentWithPatient) {
    clearMessages()
    setFormState({ mode: 'edit', appointment })
  }

  function openCancel(appointment: AppointmentWithPatient) {
    clearMessages()
    setCancelError(null)
    setCancelTarget(appointment)
  }

  function closeCancel() {
    if (isCancelling) return

    setCancelTarget(null)
    setCancelError(null)
  }

  function handleSaved(appointment: AppointmentWithPatient, mode: 'create' | 'edit') {
    applyAppointment(appointment)
    setFormState(null)

    const dateKey = toDateKey(new Date(appointment.starts_at))
    const when = `${formatDayHeading(dateKey)}, ${formatAppointmentTime(appointment.starts_at)} hs`

    setActionError(null)
    setNotice(
      mode === 'create'
        ? `Cita agendada: ${getAppointmentPatientName(appointment)} · ${when}.`
        : `Se actualizó la cita de ${getAppointmentPatientName(appointment)} · ${when}.`,
    )

    // Si la cita quedó fuera del rango visible, se navega al día guardado.
    if (!range.days.includes(dateKey)) setAnchor(dateKey)
  }

  async function handleStatusChange(
    appointment: AppointmentWithPatient,
    status: AppointmentStatus,
  ) {
    if (pendingId) return

    setPendingId(appointment.id)
    setActionError(null)
    setNotice(null)

    try {
      const updated = await updateAppointmentStatus(appointment.id, status)

      applyAppointment(updated)
      setNotice(
        `${APPOINTMENT_STATUS_META[status].label}: ${getAppointmentPatientName(updated)} · ${formatAppointmentTime(updated.starts_at)} hs.`,
      )
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo actualizar el estado de la cita. Intentá de nuevo.',
      )
    } finally {
      setPendingId(null)
    }
  }

  async function handleCancelConfirm(reason: string) {
    if (!cancelTarget || isCancelling) return

    setIsCancelling(true)
    setCancelError(null)

    try {
      const updated = await updateAppointmentStatus(cancelTarget.id, 'cancelled', {
        cancellationReason: reason,
      })

      applyAppointment(updated)
      setNotice(
        `Se canceló la cita de ${getAppointmentPatientName(updated)} (${formatAppointmentTime(updated.starts_at)} hs).`,
      )
      setCancelTarget(null)
    } catch (cause) {
      setCancelError(
        cause instanceof Error ? cause.message : 'No se pudo cancelar la cita. Intentá de nuevo.',
      )
    } finally {
      setIsCancelling(false)
    }
  }

  /**
   * Envía el recordatorio por Evolution API (WhatsApp de la clínica).
   *
   * Al volver bien se guarda `reminder_sent_at` como auditoría; si ese guardado
   * falla no se muestra error porque el mensaje ya salió del teléfono de la
   * clínica.
   */
  async function handleSendReminder(appointment: AppointmentWithPatient) {
    if (reminderPendingId) return

    clearMessages()
    setReminderPendingId(appointment.id)

    try {
      const result = await sendAppointmentReminder(appointment, appointment.patient)

      setNotice(
        `Recordatorio enviado por WhatsApp a ${getAppointmentPatientName(appointment)} (${formatPhonePY(result.number)}).`,
      )

      markReminderSent(appointment.id)
        .then(() => patchAppointment(appointment.id, { reminder_sent_at: result.sentAt }))
        .catch(() => undefined)
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo enviar el recordatorio por WhatsApp. Intentá de nuevo.',
      )
    } finally {
      setReminderPendingId(null)
    }
  }

  /**
   * «Llamar a sala»: deja la cita en `checked_in` y marca `called_at`.
   *
   * La pantalla `/tv` escucha la tabla por Realtime, así que el nombre aparece
   * en el televisor (con campanilla y voz) sin recargar nada. Si el paciente ya
   * estaba en sala se conserva su hora de llegada.
   */
  async function handleCallToRoom(appointment: AppointmentWithPatient) {
    if (callingId) return

    clearMessages()
    setCallingId(appointment.id)

    try {
      const updated = await callAppointmentToRoom(appointment)

      applyAppointment(updated)
      setNotice(
        `Llamando a ${getAppointmentPatientName(updated)}${
          updated.room ? ` · ${updated.room}` : ''
        }. La pantalla de sala ya muestra el aviso.`,
      )
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo llamar al paciente a sala. Intentá de nuevo.',
      )
    } finally {
      setCallingId(null)
    }
  }

  /** Alternativa manual: abre WhatsApp Web/App con el mensaje ya escrito. */
  function handleWhatsApp(appointment: AppointmentWithPatient) {
    const url = buildReminderUrl(appointment)

    if (!url) {
      setActionError(
        'El paciente no tiene un teléfono válido para WhatsApp. Actualizá su ficha y volvé a intentar.',
      )
      return
    }

    window.open(url, '_blank', 'noopener,noreferrer')

    setActionError(null)
    setNotice(
      `Se abrió WhatsApp con el recordatorio para ${getAppointmentPatientName(appointment)}. Enviá el mensaje desde el chat.`,
    )
  }


  const isDayViewEmpty = !isLoading && !error && view === 'day' && appointments.length === 0
  // Se recalcula en cada render: solo depende de las variables VITE_* y del protocolo.
  const whatsappStatus = getWhatsAppStatus()

  return (
    <div className="space-y-5">
      <section
        aria-label="Agenda de citas"
        aria-busy={isLoading}
        className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/85 shadow-card backdrop-blur-md"
      >
        <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
          <AgendaToolbar
            view={view}
            anchor={anchor}
            rangeLabel={rangeLabel}
            summary={summary}
            onViewChange={handleViewChange}
            onAnchorChange={(dateKey) => {
              clearMessages()
              setAnchor(dateKey)
            }}
            onPrevious={() => shiftAnchor(view === 'week' ? -7 : -1)}
            onNext={() => shiftAnchor(view === 'week' ? 7 : 1)}
            onToday={goToToday}
            onCreate={openCreate}
          />
        </div>

        {notice && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 sm:px-5"
          >
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Ocultar aviso"
              className="rounded-md p-1 text-emerald-700 transition-colors hover:bg-emerald-100"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {actionError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 border-b border-red-100 bg-red-50 px-4 py-2.5 text-sm text-red-700 sm:px-5"
          >
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              aria-label="Ocultar error"
              className="rounded-md p-1 text-red-600 transition-colors hover:bg-red-100"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {whatsappStatus.warning && (
          <div className="border-b border-amber-100 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 sm:px-5">
            {whatsappStatus.warning}
          </div>
        )}

        {patientsError && (
          <div className="flex flex-wrap items-center gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 sm:px-5">
            <span>No se pudieron cargar los pacientes para agendar: {patientsError}</span>
            <button
              type="button"
              onClick={reloadPatients}
              className="font-semibold underline underline-offset-2 hover:text-amber-900"
            >
              Reintentar
            </button>
          </div>
        )}

        {error ? (
          <div role="alert" className="flex flex-col items-center px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
              <AlertCircle className="size-7" aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-sm font-semibold text-slate-900">
              No pudimos cargar la agenda
            </h2>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-500">{error}</p>
            <button type="button" onClick={reload} className={`mt-5 ${PRIMARY_BUTTON_CLASS}`}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Reintentar
            </button>
          </div>
        ) : isLoading ? (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-3 px-6 py-20 text-center"
          >
            <Loader2 className="size-6 animate-spin text-brand-600" aria-hidden="true" />
            <p className="text-sm text-slate-500">Cargando la agenda…</p>
          </div>
        ) : isDayViewEmpty ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <CalendarX2 className="size-7" aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-sm font-semibold text-slate-900">Sin citas para este día</h2>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
              Agendá una cita para {formatDayHeading(range.from).toLowerCase()} o navegá a otra
              fecha desde la barra superior.
            </p>
            <button type="button" onClick={openCreate} className={`mt-5 ${PRIMARY_BUTTON_CLASS}`}>
              <CalendarPlus className="size-4" aria-hidden="true" />
              Agendar cita
            </button>
          </div>
        ) : (
          <AgendaList
            groups={groups}
            pendingId={pendingId}
            reminderPendingId={reminderPendingId}
            callingId={callingId}
            onEdit={openEdit}
            onStatusChange={handleStatusChange}
            onCancel={openCancel}
            onWhatsApp={handleWhatsApp}
            onSendReminder={handleSendReminder}
            onCallToRoom={handleCallToRoom}
          />
        )}
      </section>


      <p className="text-xs leading-relaxed text-slate-400">
        Los cambios de estado se guardan al instante en Supabase (con fecha de check-in, atención o
        motivo de cancelación). El botón «Recordar» envía el recordatorio por WhatsApp desde el
        número de la clínica (Evolution API); el botón de chat abre WhatsApp Web con el mensaje
        escrito para enviarlo a mano. «Llamar a sala» anuncia al paciente en la pantalla del
        televisor (<span className="font-medium text-slate-500">Pantalla de sala</span>), con
        campanilla y voz.
      </p>

      {formState && (
        <AppointmentFormModal
          key={
            formState.mode === 'edit'
              ? `edit-${formState.appointment.id}`
              : `new-${formState.date}`
          }
          appointment={formState.mode === 'edit' ? formState.appointment : null}
          patients={patients}
          defaultDate={formState.mode === 'create' ? formState.date : range.from}
          onClose={() => setFormState(null)}
          onSaved={handleSaved}
        />
      )}

      {cancelTarget && (
        <CancelAppointmentDialog
          appointment={cancelTarget}
          isBusy={isCancelling}
          error={cancelError}
          onConfirm={handleCancelConfirm}
          onClose={closeCancel}
        />
      )}
    </div>
  )
}

