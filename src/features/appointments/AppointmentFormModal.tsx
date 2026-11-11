import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, CalendarClock, Loader2, X } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { PatientPicker } from '../patients/PatientPicker'
import { patientContactLabel, type PatientOption } from '../patients/patient-contact'
import type { Patient } from '../patients/patient-types'
import {
  addMinutesToTime,
  combineDateAndTime,
  findPatientConflicts,
  findSlotConflicts,
  formatAppointmentTime,
  formatDayHeading,
  formatDuration,
  MAX_APPOINTMENT_MINUTES,
  minutesBetween,
  suggestStartTime,
  toDateKey,
} from './appointment-dates'
import {
  createAppointment,
  fetchAppointmentsForDay,
  updateAppointment,
} from './appointments-service'
import {
  normalizeRoom,
  type AppointmentFormValues,
  type AppointmentWithPatient,
} from './appointment-types'
import { useStaffDirectory } from '../team/staff-directory'
import { getRoleLabel } from '../team/team-types'

type AppointmentFormModalProps = {
  /** `null` para agendar una cita nueva. */
  appointment: AppointmentWithPatient | null
  patients: Patient[]
  /** Fecha preseleccionada al crear (`2026-10-29`). */
  defaultDate: string
  onClose: () => void
  onSaved: (appointment: AppointmentWithPatient, mode: 'create' | 'edit') => void
}

const INPUT_CLASS =
  'w-full rounded-xl border border-slate-300 bg-white/85 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500'

const LABEL_CLASS = 'mb-1 block text-sm font-medium text-slate-700'

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120]

const REASON_SUGGESTIONS = ['Control', 'Limpieza', 'Endodoncia', 'Extracción', 'Ortodoncia']

/** Referencia estable para los días sin datos (evita re-renders innecesarios). */
const EMPTY_APPOINTMENTS: AppointmentWithPatient[] = []

function buildInitialValues(
  appointment: AppointmentWithPatient | null,
  defaultDate: string,
): AppointmentFormValues {
  if (appointment) {
    return {
      patient_id: appointment.patient_id,
      dentist_id: appointment.dentist_id ?? '',
      date: toDateKey(new Date(appointment.starts_at)),
      start_time: formatAppointmentTime(appointment.starts_at),
      end_time: formatAppointmentTime(appointment.ends_at),
      reason: appointment.reason,
      notes: appointment.notes ?? '',
      room: appointment.room ?? '',
    }
  }

  const startTime = suggestStartTime(defaultDate)

  return {
    patient_id: '',
    dentist_id: '',
    date: defaultDate,
    start_time: startTime,
    end_time: addMinutesToTime(startTime, 30),
    reason: '',
    notes: '',
    room: '',
  }
}

/**
 * Alta y edición de citas.
 *
 * El estado no se elige acá: se crea como `scheduled` y se cambia con las
 * acciones rápidas de la agenda. El motivo es obligatorio (lo exige la base) y
 * los solapamientos se avisan, pero no se bloquean.
 */
export function AppointmentFormModal({
  appointment,
  patients,
  defaultDate,
  onClose,
  onSaved,
}: AppointmentFormModalProps) {
  const [values, setValues] = useState<AppointmentFormValues>(() =>
    buildInitialValues(appointment, defaultDate),
  )
  const [daySnapshot, setDaySnapshot] = useState<{
    dateKey: string
    appointments: AppointmentWithPatient[]
  }>({ dateKey: '', appointments: [] })
  const [isSaving, setIsSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const mode = appointment ? 'edit' : 'create'

  const { members: staff, isLoading: isStaffLoading, error: staffError } = useStaffDirectory()

  const selectedPatient: PatientOption | null = useMemo(() => {
    const fromList = patients.find((patient) => patient.id === values.patient_id)

    if (fromList) return fromList
    if (appointment?.patient && appointment.patient_id === values.patient_id) {
      return appointment.patient
    }

    return null
  }, [patients, values.patient_id, appointment])

  useEffect(() => {
    let isCurrent = true

    if (!values.date) return

    fetchAppointmentsForDay(values.date)
      .then((rows) => {
        if (isCurrent) setDaySnapshot({ dateKey: values.date, appointments: rows })
      })
      .catch(() => {
        // Sin la agenda del día no se pueden avisar solapamientos; el alta sigue.
        if (isCurrent) setDaySnapshot({ dateKey: values.date, appointments: [] })
      })

    return () => {
      isCurrent = false
    }
  }, [values.date])

  // Si la fecha cambió y todavía no llegó la respuesta, se ignora el día anterior.
  const dayAppointments =
    daySnapshot.dateKey === values.date ? daySnapshot.appointments : EMPTY_APPOINTMENTS

  const slot = useMemo(() => {
    const start = combineDateAndTime(values.date, values.start_time)
    const end = combineDateAndTime(values.date, values.end_time)

    if (!start || !end) return null

    return { starts_at: start.toISOString(), ends_at: end.toISOString() }
  }, [values.date, values.start_time, values.end_time])

  const duration = slot ? minutesBetween(slot.starts_at, slot.ends_at) : 0

  const patientConflicts = useMemo(() => {
    if (!slot || !values.patient_id) return []

    return findPatientConflicts(
      dayAppointments,
      { ...slot, patient_id: values.patient_id },
      appointment?.id,
    )
  }, [dayAppointments, slot, values.patient_id, appointment?.id])

  const otherConflicts = useMemo(() => {
    if (!slot) return []

    return findSlotConflicts(dayAppointments, slot, appointment?.id).filter(
      (item) => item.patient_id !== values.patient_id,
    )
  }, [dayAppointments, slot, values.patient_id, appointment?.id])


  function setField<K extends keyof AppointmentFormValues>(
    key: K,
    value: AppointmentFormValues[K],
  ): void {
    setValues((current) => ({ ...current, [key]: value }))
    setSubmitError(null)
  }

  /** Al mover el inicio se conserva la duración elegida. */
  function handleStartTimeChange(nextStart: string): void {
    const previousDuration = duration > 0 ? duration : 30

    setValues((current) => ({
      ...current,
      start_time: nextStart,
      end_time: addMinutesToTime(nextStart, previousDuration),
    }))
    setSubmitError(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (isSaving) return

    const start = combineDateAndTime(values.date, values.start_time)
    const end = combineDateAndTime(values.date, values.end_time)
    const reason = values.reason.trim()

    if (!values.patient_id) {
      setSubmitError('Elegí el paciente de la cita.')
      return
    }

    if (!start) {
      setSubmitError('Indicá una hora de inicio válida.')
      return
    }

    if (!end) {
      setSubmitError('Indicá una hora de fin válida.')
      return
    }

    const minutes = minutesBetween(start.toISOString(), end.toISOString())

    if (minutes <= 0) {
      setSubmitError('La hora de fin debe ser posterior a la de inicio.')
      return
    }

    if (minutes < 5) {
      setSubmitError('La cita debe durar al menos 5 minutos.')
      return
    }

    if (minutes > MAX_APPOINTMENT_MINUTES) {
      setSubmitError('La cita no puede durar más de 8 horas.')
      return
    }

    if (!reason) {
      setSubmitError('Escribí el motivo de la consulta.')
      return
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setSubmitError('Sin conexión: no se puede guardar la cita. Revisá tu internet.')
      return
    }

    setIsSaving(true)
    setSubmitError(null)

    const input = {
      patient_id: values.patient_id,
      dentist_id: values.dentist_id || null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      reason,
      notes: values.notes.trim() || null,
      room: normalizeRoom(values.room),
    }

    try {
      const saved = appointment
        ? await updateAppointment(appointment.id, input, {
            // Si el paciente había pedido reagendar por WhatsApp, reprogramar
            // cierra el pedido y la cita vuelve a "Programada".
            resetRescheduleRequest: appointment.status === 'reschedule_requested',
          })
        : await createAppointment(input)

      onSaved(saved, mode)
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'No se pudo guardar la cita.')
      setIsSaving(false)
    }
  }

  return (
    <Modal
      title={mode === 'edit' ? 'Editar cita' : 'Agendar cita'}
      description={
        mode === 'edit'
          ? 'Cambiá el horario o el motivo. El estado se actualiza desde la agenda.'
          : 'Reservá un horario para un paciente ya registrado. El estado inicial es "Programada".'
      }
      size="lg"
      isBusy={isSaving}
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white/85 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="appointment-form"
            disabled={isSaving}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSaving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {isSaving ? 'Guardando…' : mode === 'edit' ? 'Guardar cambios' : 'Agendar cita'}
          </button>
        </div>
      }
    >
      <form id="appointment-form" onSubmit={handleSubmit} className="space-y-5" noValidate>
        {submitError && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-200"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {submitError}
          </p>
        )}

        <fieldset>
          <legend className={LABEL_CLASS}>Paciente</legend>

          {selectedPatient ? (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {selectedPatient.first_name} {selectedPatient.last_name}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {patientContactLabel(selectedPatient) || 'Sin documento ni teléfono'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setField('patient_id', '')
                }}
                disabled={isSaving}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white/85 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-50"
              >
                <X className="size-3.5" aria-hidden="true" />
                Cambiar
              </button>
            </div>
          ) : (
            <PatientPicker
              patients={patients}
              autoFocus
              idPrefix="appointment-patient"
              onSelect={(patient) => {
                setField('patient_id', patient.id)
              }}
            />
          )}
        </fieldset>


        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="appointment-date" className={LABEL_CLASS}>
              Fecha
            </label>
            <input
              id="appointment-date"
              type="date"
              required
              value={values.date}
              onChange={(event) => setField('date', event.target.value)}
              disabled={isSaving}
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <span className={LABEL_CLASS}>Duración estimada</span>
            <div className="flex flex-wrap gap-1.5">
              {DURATION_OPTIONS.map((option) => {
                const isActive = duration === option

                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setField('end_time', addMinutesToTime(values.start_time, option))}
                    aria-pressed={isActive}
                    disabled={isSaving}
                    className={[
                      'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
                      isActive
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-slate-300 bg-white/85 text-slate-600 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    {formatDuration(option)}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="appointment-start" className={LABEL_CLASS}>
              Hora de inicio
            </label>
            <input
              id="appointment-start"
              type="time"
              required
              step={300}
              value={values.start_time}
              onChange={(event) => handleStartTimeChange(event.target.value)}
              disabled={isSaving}
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="appointment-end" className={LABEL_CLASS}>
              Hora de fin
            </label>
            <input
              id="appointment-end"
              type="time"
              required
              step={300}
              value={values.end_time}
              onChange={(event) => setField('end_time', event.target.value)}
              disabled={isSaving}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="appointment-dentist" className={LABEL_CLASS}>
              Profesional <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <select
              id="appointment-dentist"
              value={values.dentist_id}
              onChange={(event) => setField('dentist_id', event.target.value)}
              disabled={isSaving || isStaffLoading}
              className={INPUT_CLASS}
            >
              <option value="">Sin asignar</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name} · {getRoleLabel(member.role)}
                </option>
              ))}
            </select>
            {staffError && <p className="mt-1 text-xs text-amber-700">{staffError}</p>}
            {!isStaffLoading && !staffError && staff.length === 0 && (
              <p className="mt-1 text-xs text-slate-400">
                Aplicá la migración de la pantalla de sala para elegir el profesional.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="appointment-room" className={LABEL_CLASS}>
              Consultorio / box <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <input
              id="appointment-room"
              type="text"
              maxLength={40}
              value={values.room}
              onChange={(event) => setField('room', event.target.value)}
              placeholder="Ej.: Box 1, Consultorio 2"
              disabled={isSaving}
              className={INPUT_CLASS}
            />
            <p className="mt-1 text-xs text-slate-400">
              Es lo que la pantalla de sala muestra debajo del nombre.
            </p>
          </div>
        </div>

        <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
          <CalendarClock className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
          <span>
            {formatDayHeading(values.date)} · {values.start_time || '--:--'} a{' '}
            {values.end_time || '--:--'} hs
            {duration > 0 && ` (${formatDuration(duration)})`}
          </span>
        </p>

        {patientConflicts.length > 0 && (
          <p
            role="status"
            className="flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-rose-200"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Este paciente ya tiene una cita de{' '}
              {formatAppointmentTime(patientConflicts[0].starts_at)} a{' '}
              {formatAppointmentTime(patientConflicts[0].ends_at)} ese día.
            </span>
          </p>
        )}

        {otherConflicts.length > 0 && (
          <p
            role="status"
            className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800 ring-1 ring-amber-200"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Se superpone con {otherConflicts.length}{' '}
              {otherConflicts.length === 1 ? 'cita' : 'citas'} de la agenda (
              {formatAppointmentTime(otherConflicts[0].starts_at)} –{' '}
              {formatAppointmentTime(otherConflicts[0].ends_at)}).
            </span>
          </p>
        )}


        <div>
          <label htmlFor="appointment-reason" className={LABEL_CLASS}>
            Motivo de la consulta
          </label>
          <input
            id="appointment-reason"
            type="text"
            required
            maxLength={120}
            value={values.reason}
            onChange={(event) => setField('reason', event.target.value)}
            placeholder="Ej.: Control, limpieza, endodoncia…"
            disabled={isSaving}
            className={INPUT_CLASS}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REASON_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setField('reason', suggestion)}
                disabled={isSaving}
                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="appointment-notes" className={LABEL_CLASS}>
            Notas <span className="font-normal text-slate-400">(opcional)</span>
          </label>
          <textarea
            id="appointment-notes"
            rows={3}
            maxLength={500}
            value={values.notes}
            onChange={(event) => setField('notes', event.target.value)}
            placeholder="Indicaciones previas, obra social, estudios pendientes…"
            disabled={isSaving}
            className={`${INPUT_CLASS} resize-y`}
          />
        </div>
      </form>
    </Modal>
  )
}
