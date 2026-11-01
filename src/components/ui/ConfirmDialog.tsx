import { AlertTriangle, Loader2 } from 'lucide-react'
import { Modal } from './Modal'

type ConfirmDialogProps = {
  title: string
  description: string
  confirmLabel: string
  busyLabel?: string
  isBusy?: boolean
  error?: string | null
  onConfirm: () => void
  onClose: () => void
}

/** Confirmación para acciones destructivas (el foco inicial queda en Cancelar). */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  busyLabel = 'Procesando…',
  isBusy = false,
  error = null,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onClose}
      isBusy={isBusy}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            data-autofocus
            onClick={onClose}
            disabled={isBusy}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white/85 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isBusy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {isBusy ? busyLabel : confirmLabel}
          </button>
        </div>
      }
    >
      <div className="flex gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm leading-relaxed text-slate-600">{description}</p>
          {error && (
            <p
              role="alert"
              className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </Modal>
  )
}
