import { useMemo, useState, type FormEvent } from 'react'
import {
  AlertCircle,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Loader2,
  Wallet,
} from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { formatPYG, formatPYGInput, parsePYGInput } from '../../lib/format'
import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from '../cash/cash-types'
import { getTodayKey } from './invoicing-format'
import { getInstallmentLabel } from './invoicing-payments'
import { registerInvoicePayment } from './invoicing-service'
import {
  INSTALLMENT_STATUS_META,
  PAYMENT_STATUS_META,
  getInvoiceBalance,
  getInvoiceInstallments,
  getInvoicePaidAmount,
  getInvoicePaymentState,
  type Invoice,
} from './invoicing-types'

type InvoicePaymentModalProps = {
  invoice: Invoice
  onClose: () => void
  onRegistered: (invoice: Invoice) => void
}

const INPUT_CLASS =
  'w-full rounded-xl border border-slate-300 bg-white/85 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500'

const LABEL_CLASS = 'mb-1 block text-sm font-medium text-slate-700'

/**
 * Registro de un cobro o abono sobre una factura emitida.
 *
 * La base crea el movimiento en caja, lo aplica a la factura —y a la cuota que
 * corresponda— y recalcula el saldo en una sola transacción. Si el cobro supera
 * el saldo se rechaza: primero hay que corregir el importe.
 */
export function InvoicePaymentModal({
  invoice,
  onClose,
  onRegistered,
}: InvoicePaymentModalProps) {
  const balance = getInvoiceBalance(invoice)
  const installmentList = useMemo(() => getInvoiceInstallments(invoice), [invoice])
  const openInstallments = useMemo(
    () => installmentList.filter((item) => item.paid_amount < item.amount),
    [installmentList],
  )

  const [amountInput, setAmountInput] = useState(() => formatPYGInput(String(balance)))
  const [method, setMethod] = useState<PaymentMethod | ''>('cash')
  const [installmentId, setInstallmentId] = useState('')
  const [paidAt, setPaidAt] = useState(() => getTodayKey())
  const [reference, setReference] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amount = parsePYGInput(amountInput)
  const nextBalance = Math.max(balance - amount, 0)
  const exceedsBalance = amount > balance

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSaving) return

    if (amount <= 0) {
      setError('El importe del cobro debe ser mayor a cero.')
      return
    }

    if (exceedsBalance) {
      setError(`El saldo de la factura es ${formatPYG(balance)}.`)
      return
    }

    if (!method) {
      setError('Elegí la forma de pago del cobro.')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const updated = await registerInvoicePayment({
        invoiceId: invoice.id,
        amount,
        method,
        installmentId: installmentId || null,
        paidAt,
        reference,
      })
      onRegistered(updated)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo registrar el cobro. Volvé a intentar.',
      )
      setIsSaving(false)
    }
  }

  const canCollect = balance > 0 && invoice.status === 'issued'

  return (
    <Modal
      title="Registrar cobro"
      description={`${invoice.invoice_number} · ${invoice.customer_name}`}
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
            Cancelar
          </button>
          <button
            type="submit"
            form="invoice-payment-form"
            disabled={isSaving || !canCollect || amount <= 0 || exceedsBalance}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Banknote className="size-4" aria-hidden="true" />
            )}
            {isSaving ? 'Registrando…' : 'Registrar cobro'}
          </button>
        </div>
      }
    >
      <form id="invoice-payment-form" onSubmit={handleSubmit} className="space-y-3">
        <dl className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-center ring-1 ring-slate-200">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-slate-500">Total</dt>
            <dd className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-slate-900">
              {formatPYG(invoice.total)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-slate-500">Cobrado</dt>
            <dd className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-emerald-700">
              {formatPYG(getInvoicePaidAmount(invoice))}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-slate-500">Saldo</dt>
            <dd className="mt-0.5 font-mono text-xs font-semibold tabular-nums text-amber-700">
              {formatPYG(balance)}
            </dd>
          </div>
        </dl>

        {invoice.status !== 'issued' ? (
          <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs text-red-700 ring-1 ring-red-200">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            La factura está anulada: no admite cobros.
          </p>
        ) : balance <= 0 ? (
          <p className="flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800 ring-1 ring-emerald-200">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Esta factura ya está saldada: {PAYMENT_STATUS_META[getInvoicePaymentState(invoice)].label}.
          </p>
        ) : null}

        {canCollect && (
          <>
            <div>
              <label htmlFor="invoice-payment-amount" className={LABEL_CLASS}>
                Importe del cobro
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                  ₲
                </span>
                <input
                  id="invoice-payment-amount"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={amountInput}
                  onChange={(event) => {
                    setAmountInput(formatPYGInput(event.target.value))
                    setError(null)
                  }}
                  disabled={isSaving}
                  className={`${INPUT_CLASS} pl-8 text-right font-mono text-base tabular-nums`}
                />
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setAmountInput(formatPYGInput(String(balance)))}
                  disabled={isSaving}
                  className="rounded-lg border border-slate-300 bg-white/85 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Todo el saldo · {formatPYG(balance)}
                </button>
                {openInstallments.slice(0, 2).map((installment) => {
                  const due = installment.amount - installment.paid_amount

                  return (
                    <button
                      key={installment.id}
                      type="button"
                      onClick={() => {
                        setAmountInput(formatPYGInput(String(Math.min(due, balance))))
                        setInstallmentId(installment.id)
                      }}
                      disabled={isSaving}
                      title={getInstallmentLabel(installment, installmentList.length)}
                      className="rounded-lg border border-slate-300 bg-white/85 px-2.5 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      Cuota {installment.number} · {formatPYG(due)}
                    </button>
                  )
                })}
              </div>
            </div>

            {openInstallments.length > 0 && (
              <div>
                <label htmlFor="invoice-payment-installment" className={LABEL_CLASS}>
                  Imputar a una cuota{' '}
                  <span className="font-normal text-slate-400">(opcional)</span>
                </label>
                <select
                  id="invoice-payment-installment"
                  value={installmentId}
                  onChange={(event) => setInstallmentId(event.target.value)}
                  disabled={isSaving}
                  className={INPUT_CLASS}
                >
                  <option value="">Automático (primera cuota impaga)</option>
                  {openInstallments.map((installment) => (
                    <option key={installment.id} value={installment.id}>
                      {getInstallmentLabel(installment, installmentList.length)} ·{' '}
                      {INSTALLMENT_STATUS_META[installment.status].label} ·{' '}
                      {formatPYG(installment.amount - installment.paid_amount)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="invoice-payment-method" className={LABEL_CLASS}>
                  Forma de pago
                </label>
                <select
                  id="invoice-payment-method"
                  value={method}
                  onChange={(event) => setMethod(event.target.value as PaymentMethod | '')}
                  disabled={isSaving}
                  className={INPUT_CLASS}
                >
                  <option value="">Sin especificar</option>
                  {PAYMENT_METHOD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="invoice-payment-date" className={LABEL_CLASS}>
                  Fecha del cobro
                </label>
                <div className="relative">
                  <CalendarDays
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="invoice-payment-date"
                    type="date"
                    value={paidAt}
                    onChange={(event) => setPaidAt(event.target.value)}
                    disabled={isSaving}
                    className={`${INPUT_CLASS} pl-9 font-mono`}
                  />
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="invoice-payment-reference" className={LABEL_CLASS}>
                Referencia <span className="font-normal text-slate-400">(opcional)</span>
              </label>
              <input
                id="invoice-payment-reference"
                type="text"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                disabled={isSaving}
                maxLength={120}
                placeholder="N.º de transferencia, cheque, autorización"
                className={INPUT_CLASS}
              />
            </div>

            <div className="flex items-start gap-2 rounded-xl bg-indigo-50 px-3 py-2.5 text-xs leading-relaxed text-indigo-900 ring-1 ring-indigo-200">
              <Wallet className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>
                El cobro queda como movimiento de caja del paciente y se aplica a esta factura.
                Saldo después del cobro: {formatPYG(nextBalance)}.
              </p>
            </div>
          </>
        )}

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


