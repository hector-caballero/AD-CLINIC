import { useState, type FormEvent } from 'react'
import { Ban, Loader2 } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { formatAppointmentTime, formatDayHeading, toDateKey } from './appointment-dates'
import {
  getAppointmentPatientName,
  type AppointmentWithPatient,
} from './appointment-types'

type CancelAppointmentDialogProps = {
  appointment: AppointmentWithPatient
  isBusy: boolean
  error: string | null
  onConfirm: (reason: string) => void
  onClose: () => void
}

const SUGGESTED_REASONS = [
  'El paciente avisó que no puede asistir',
  'Reprogramada a otro día',
  'Emergencia del profesional',
  'El paciente no se presentó',
]

/**
 * Cancelación con motivo.
 *
 * La base exige `cancellation_reason` cuando el estado es `cancelled`
 * (`appointments_cancellation_reason_check`), así que el motivo es obligatorio.
 */
export function CancelAppointmentDialog({
  appointment,
  isBusy,
  error,
  onConfirm,
  onClose,
}: CancelAppointmentDialogProps) {
  const [reason, setReason] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  const patientName = getAppointmentPatientName(appointment)
  const dayLabel = formatDayHeading(toDateKey(new Date(appointment.starts_at)))
  const timeLabel = `${formatAppointmentTime(appointment.starts_at)} a ${formatAppointmentTime(appointment.ends_at)} hs`

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    const trimmed = reason.trim()

    if (!trimmed) {
      setLocalError('Indicá el motivo de la cancelación.')
      return
    }

    setLocalError(null)
    onConfirm(trimmed)
  }

  return (
    <Modal
      title="Cancelar cita"
      description={`${patientName} · ${dayLabel}, ${timeLabel}`}
      size="sm"
      isBusy={isBusy}
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            Volver
          </button>
          <button
            type="submit"
            form="cancel-appointment-form"
            disabled={isBusy}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Ban className="size-4" aria-hidden="true" />
            )}
            {isBusy ? 'Cancelando…' : 'Cancelar cita'}
          </button>
        </div>
      }
    >
      <form id="cancel-appointment-form" onSubmit={handleSubmit} className="space-y-4" noValidate>
        <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800 ring-1 ring-amber-200">
          El horario queda libre para otro paciente y la cita deja de contar como pendiente.
        </p>

        <div>
          <label htmlFor="cancellation-reason" className="mb-1 block text-sm font-medium text-slate-700">
            Motivo de la cancelación
          </label>
          <textarea
            id="cancellation-reason"
            data-autofocus
            rows={3}
            maxLength={200}
            required
            value={reason}
            onChange={(event) => {
              setReason(event.target.value)
              setLocalError(null)
            }}
            placeholder="Ej.: el paciente avisó que no puede asistir."
            disabled={isBusy}
            className="w-full resize-y rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500"
          />
          <p className="mt-1 text-right text-[11px] tabular-nums text-slate-400">
            {reason.length}/200
          </p>

          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_REASONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => {
                  setReason(suggestion)
                  setLocalError(null)
                }}
                disabled={isBusy}
                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-left text-xs font-medium text-slate-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>

        {(localError || error) && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"
          >
            {localError ?? error}
          </p>
        )}
      </form>
    </Modal>
  )
}
