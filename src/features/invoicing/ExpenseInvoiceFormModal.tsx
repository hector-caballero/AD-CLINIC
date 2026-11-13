import { useMemo, useState, type FormEvent } from 'react'
import { AlertCircle, Loader2, ReceiptText } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { formatPYG, formatPYGInput, parsePYGInput } from '../../lib/format'
import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from '../cash/cash-types'
import {
  autoFormatRuc,
  formatTimbradoInput,
  getTodayKey,
  isValidRuc,
  RUC_FORMAT_HINT,
} from './invoicing-format'
import { saveExpenseInvoice, type ExpenseInvoiceInput } from './invoicing-service'
import { computeVatBreakdown } from './invoicing-tax'
import {
  EXPENSE_KIND_OPTIONS,
  getIssuerName,
  type ExpenseInvoice,
  type TaxIssuer,
} from './invoicing-types'
import { RucLookupField } from './RucLookupField'

type ExpenseInvoiceFormModalProps = {
  issuers: TaxIssuer[]
  /** Gasto a editar; `null`/ausente crea uno nuevo. */
  expense?: ExpenseInvoice | null
  onClose: () => void
  onSaved: (expense: ExpenseInvoice) => void
}

const INPUT_CLASS =
  'w-full rounded-xl border border-slate-300 bg-white/85 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500'

const LABEL_CLASS = 'mb-1 block text-sm font-medium text-slate-700'

const HELP_CLASS = 'mt-1 text-xs leading-relaxed text-slate-400'

/**
 * Alta y edición de una factura de gasto.
 *
 * El comprobante del proveedor se carga tal como viene (timbrado y número a
 * mano) y el desglose se hace por franja de IVA. El total y el IVA despejado
 * los recalcula el servicio con los divisores de la SET, así lo guardado
 * nunca difiere de lo que muestra la pantalla.
 */
export function ExpenseInvoiceFormModal({
  issuers,
  expense = null,
  onClose,
  onSaved,
}: ExpenseInvoiceFormModalProps) {
  const [supplierName, setSupplierName] = useState(expense?.supplier_name ?? '')
  const [supplierRuc, setSupplierRuc] = useState(
    expense?.supplier_ruc ? autoFormatRuc(expense.supplier_ruc) : '',
  )
  const [timbradoNumber, setTimbradoNumber] = useState(expense?.timbrado_number ?? '')
  const [invoiceNumber, setInvoiceNumber] = useState(expense?.invoice_number ?? '')
  const [expenseKind, setExpenseKind] = useState(expense?.expense_kind ?? '')
  const [issuedOn, setIssuedOn] = useState(expense?.issued_on ?? getTodayKey())
  const [description, setDescription] = useState(expense?.description ?? '')

  const [amount10Input, setAmount10Input] = useState(
    expense && expense.amount_10 > 0 ? formatPYGInput(String(expense.amount_10)) : '',
  )
  const [amount5Input, setAmount5Input] = useState(
    expense && expense.amount_5 > 0 ? formatPYGInput(String(expense.amount_5)) : '',
  )
  const [exemptInput, setExemptInput] = useState(
    expense && expense.amount_exempt > 0 ? formatPYGInput(String(expense.amount_exempt)) : '',
  )

  const [method, setMethod] = useState<PaymentMethod | ''>(expense?.payment_method ?? '')
  const [attributedIssuerId, setAttributedIssuerId] = useState(
    expense?.attributed_issuer_id ?? '',
  )
  const [notes, setNotes] = useState(expense?.notes ?? '')

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const breakdown = useMemo(
    () =>
      computeVatBreakdown({
        amount10: parsePYGInput(amount10Input),
        amount5: parsePYGInput(amount5Input),
        exempt: parsePYGInput(exemptInput),
      }),
    [amount10Input, amount5Input, exemptInput],
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSaving) return

    const formattedRuc = autoFormatRuc(supplierRuc)

    if (formattedRuc && !isValidRuc(formattedRuc)) {
      setError(`Revisá el RUC del proveedor: ${RUC_FORMAT_HINT}.`)
      return
    }

    setIsSaving(true)
    setError(null)

    const input: ExpenseInvoiceInput = {
      supplier_name: supplierName,
      supplier_ruc: formattedRuc || null,
      timbrado_number: timbradoNumber.trim() || null,
      invoice_number: invoiceNumber,
      expense_kind: expenseKind || null,
      issued_on: issuedOn,
      description: description.trim() || null,
      amount10: breakdown.amount10,
      amount5: breakdown.amount5,
      exempt: breakdown.exempt,
      payment_method: method || null,
      attributed_issuer_id: attributedIssuerId || null,
      notes: notes.trim() || null,
    }

    try {
      const saved = await saveExpenseInvoice(input, expense?.id ?? null)
      onSaved(saved)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo guardar el gasto. Volvé a intentar.',
      )
      setIsSaving(false)
    }
  }

  return (
    <Modal
      title={expense ? 'Editar factura de gasto' : 'Registrar factura de gasto'}
      description="Compras e insumos del consultorio con su desglose de IVA."
      size="lg"
      isBusy={isSaving}
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            Total del gasto:{' '}
            <span className="font-mono font-semibold tabular-nums text-slate-900">
              {formatPYG(breakdown.total)}
            </span>
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
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
              form="expense-invoice-form"
              disabled={isSaving}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ReceiptText className="size-4" aria-hidden="true" />
              )}
              {isSaving ? 'Guardando…' : expense ? 'Guardar cambios' : 'Registrar gasto'}
            </button>
          </div>
        </div>
      }
    >
      <form id="expense-invoice-form" onSubmit={handleSubmit} className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Proveedor</h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="expense-supplier" className={LABEL_CLASS}>
                Nombre o razón social
              </label>
              <input
                id="expense-supplier"
                type="text"
                value={supplierName}
                onChange={(event) => setSupplierName(event.target.value)}
                disabled={isSaving}
                maxLength={160}
                required
                placeholder="Distribuidora Dental S.A."
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <RucLookupField
                id="expense-supplier-ruc"
                label="RUC del proveedor"
                value={supplierRuc}
                onChange={setSupplierRuc}
                onResolved={(found) => {
                  if (!supplierName.trim()) setSupplierName(found.name)
                }}
                disabled={isSaving}
                placeholder="80012345-6"
              />
            </div>

            <div>
              <label htmlFor="expense-issued-on" className={LABEL_CLASS}>
                Fecha de emisión
              </label>
              <input
                id="expense-issued-on"
                type="date"
                value={issuedOn}
                onChange={(event) => setIssuedOn(event.target.value)}
                disabled={isSaving}
                required
                className={INPUT_CLASS}
              />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Comprobante</h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="expense-timbrado" className={LABEL_CLASS}>
                Timbrado
              </label>
              <input
                id="expense-timbrado"
                type="text"
                inputMode="numeric"
                value={timbradoNumber}
                onChange={(event) => setTimbradoNumber(formatTimbradoInput(event.target.value))}
                disabled={isSaving}
                placeholder="12345678"
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>

            <div>
              <label htmlFor="expense-number" className={LABEL_CLASS}>
                Número de factura
              </label>
              <input
                id="expense-number"
                type="text"
                value={invoiceNumber}
                onChange={(event) => setInvoiceNumber(event.target.value)}
                disabled={isSaving}
                maxLength={30}
                required
                placeholder="001-001-0000123"
                className={`${INPUT_CLASS} font-mono`}
              />
            </div>

            <div>
              <label htmlFor="expense-kind" className={LABEL_CLASS}>
                Categoría
              </label>
              <select
                id="expense-kind"
                value={expenseKind}
                onChange={(event) => setExpenseKind(event.target.value)}
                disabled={isSaving}
                className={INPUT_CLASS}
              >
                <option value="">Sin categoría</option>
                {EXPENSE_KIND_OPTIONS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="expense-description" className={LABEL_CLASS}>
                Detalle
              </label>
              <input
                id="expense-description"
                type="text"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={isSaving}
                maxLength={200}
                placeholder="Guantes, anestesia, resinas…"
                className={INPUT_CLASS}
              />
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Importes e IVA</h3>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="expense-amount-10" className={LABEL_CLASS}>
                Gravado 10 %
              </label>
              <input
                id="expense-amount-10"
                type="text"
                inputMode="numeric"
                value={amount10Input}
                onChange={(event) => setAmount10Input(formatPYGInput(event.target.value))}
                disabled={isSaving}
                placeholder="0"
                className={`${INPUT_CLASS} text-right font-mono tabular-nums`}
              />
            </div>

            <div>
              <label htmlFor="expense-amount-5" className={LABEL_CLASS}>
                Gravado 5 %
              </label>
              <input
                id="expense-amount-5"
                type="text"
                inputMode="numeric"
                value={amount5Input}
                onChange={(event) => setAmount5Input(formatPYGInput(event.target.value))}
                disabled={isSaving}
                placeholder="0"
                className={`${INPUT_CLASS} text-right font-mono tabular-nums`}
              />
            </div>

            <div>
              <label htmlFor="expense-amount-exempt" className={LABEL_CLASS}>
                Exenta
              </label>
              <input
                id="expense-amount-exempt"
                type="text"
                inputMode="numeric"
                value={exemptInput}
                onChange={(event) => setExemptInput(formatPYGInput(event.target.value))}
                disabled={isSaving}
                placeholder="0"
                className={`${INPUT_CLASS} text-right font-mono tabular-nums`}
              />
            </div>
          </div>

          <p className={HELP_CLASS}>
            Cargá el importe tal como figura en la factura del proveedor (IVA incluido). El IVA
            despejado se calcula solo: 10 % ÷ 11 y 5 % ÷ 21.
          </p>

          <dl className="grid gap-3 rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200 sm:grid-cols-3">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">IVA 10 %</dt>
              <dd className="mt-0.5 font-mono text-sm tabular-nums text-slate-900">
                {formatPYG(breakdown.iva10)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">IVA 5 %</dt>
              <dd className="mt-0.5 font-mono text-sm tabular-nums text-slate-900">
                {formatPYG(breakdown.iva5)}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">Total</dt>
              <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900">
                {formatPYG(breakdown.total)}
              </dd>
            </div>
          </dl>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">Pago e imputación</h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="expense-method" className={LABEL_CLASS}>
                Forma de pago
              </label>
              <select
                id="expense-method"
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
              <label htmlFor="expense-attribution" className={LABEL_CLASS}>
                Imputar a
              </label>
              <select
                id="expense-attribution"
                value={attributedIssuerId}
                onChange={(event) => setAttributedIssuerId(event.target.value)}
                disabled={isSaving}
                className={INPUT_CLASS}
              >
                <option value="">Clínica (gasto general)</option>
                {issuers.map((issuer) => (
                  <option key={issuer.id} value={issuer.id}>
                    {getIssuerName(issuer)} · RUC {issuer.ruc}
                  </option>
                ))}
              </select>
              <p className={HELP_CLASS}>
                En multi-emisor podés imputar la compra al profesional que la usó; el gasto general
                queda a nombre de la clínica.
              </p>
            </div>
          </div>

          <div>
            <label htmlFor="expense-notes" className={LABEL_CLASS}>
              Observaciones <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <textarea
              id="expense-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={isSaving}
              maxLength={300}
              placeholder="Número de orden de compra, condiciones, etc."
              className={`${INPUT_CLASS} resize-none`}
            />
          </div>
        </section>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-200"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}

