import { useState, type FormEvent } from 'react'
import { AlertCircle, Ban, Loader2 } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { formatPYG } from '../../lib/format'
import { cancelInvoice } from './invoicing-service'
import type { Invoice } from './invoicing-types'

type CancelInvoiceModalProps = {
  invoice: Invoice
  onClose: () => void
  onCancelled: (invoice: Invoice) => void
}

const INPUT_CLASS =
  'w-full rounded-xl border border-slate-300 bg-white/85 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500'

/**
 * Anulación de una factura emitida.
 *
 * La factura no se borra: se marca como anulada con el motivo (queda en el
 * libro para la SET y para el cliente). El correlativo consumido no se
 * devuelve al timbrado.
 */
export function CancelInvoiceModal({
  invoice,
  onClose,
  onCancelled,
}: CancelInvoiceModalProps) {
  const [reason, setReason] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = reason.trim()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSaving) return

    setIsSaving(true)
    setError(null)

    try {
      const cancelled = await cancelInvoice(invoice.id, trimmed)
      onCancelled(cancelled)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo anular la factura. Volvé a intentar.',
      )
      setIsSaving(false)
    }
  }

  return (
    <Modal
      title="Anular factura"
      description={`${invoice.invoice_number} · ${formatPYG(invoice.total)}`}
      size="sm"
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
            Volver
          </button>
          <button
            type="submit"
            form="cancel-invoice-form"
            disabled={isSaving || !trimmed}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Ban className="size-4" aria-hidden="true" />
            )}
            {isSaving ? 'Anulando…' : 'Anular factura'}
          </button>
        </div>
      }
    >
      <form id="cancel-invoice-form" onSubmit={handleSubmit} className="space-y-3">
        <div className="flex gap-3 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900 ring-1 ring-amber-200">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            La factura queda registrada como anulada con su motivo. El correlativo usado no vuelve
            al timbrado: la numeración sigue avanzando.
          </p>
        </div>

        <div>
          <label htmlFor="cancel-reason" className="mb-1 block text-sm font-medium text-slate-700">
            Motivo de la anulación
          </label>
          <textarea
            id="cancel-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={isSaving}
            maxLength={300}
            required
            placeholder="Error en el monto, devolución del tratamiento, etc."
            className={`${INPUT_CLASS} resize-none`}
          />
          <p className="mt-1 text-xs text-slate-400">{trimmed.length}/300 caracteres</p>
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"
          >
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
