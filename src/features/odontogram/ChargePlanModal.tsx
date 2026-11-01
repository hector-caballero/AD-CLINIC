import { useMemo, useState, type FormEvent } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  Check,
  CreditCard,
  Loader2,
  MoreHorizontal,
  Receipt,
  ShieldCheck,
} from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { formatPYG } from '../../lib/format'
import { buildReceiptSuggestion, normalizeReceiptNumber } from '../cash/cash-format'
import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from '../cash/cash-types'
import {
  ITEM_STATUS_META,
  buildChargeNote,
  getChargeableItems,
  getItemAmount,
  getSurfaceLabel,
  type OdontogramItem,
  type ToothSurface,
} from './odontogram-types'

const INPUT_CLASS =
  'w-full rounded-xl border border-slate-300 bg-white/85 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500'

const LABEL_CLASS = 'mb-1 block text-sm font-medium text-slate-700'

const METHOD_ICONS: Record<PaymentMethod, typeof Banknote> = {
  cash: Banknote,
  card: CreditCard,
  transfer: ArrowLeftRight,
  insurance: ShieldCheck,
  other: MoreHorizontal,
}

/** Una línea elegida para enviar a caja (el importe sale del odontograma). */
export type PlanChargeLine = {
  itemId: string
  treatmentId: string
  quantity: number
  unitPrice: number
  /** Pieza y cara viajan a la caja para dejar la referencia clínica. */
  toothNumber: number
  surface: ToothSurface | null
}

/** Datos del cobro del plan; los completa la página con el paciente. */
export type PlanChargeSubmission = {
  lines: PlanChargeLine[]
  collected: boolean
  method: PaymentMethod | null
  receiptNumber: string | null
  notes: string | null
}

type ChargePlanModalProps = {
  patientName: string
  /** Todas las líneas del odontograma; el modal filtra las cobrables. */
  items: OdontogramItem[]
  onClose: () => void
  onSubmit: (submission: PlanChargeSubmission) => Promise<void>
}

/**
 * «Cobrar este plan»: elige líneas del presupuesto y las envía a la caja con el
 * mismo flujo que un cobro de tratamiento (`registerTreatmentCharge`).
 *
 * - Solo se listan líneas con precio y sin cobro previo; las piezas ausentes no
 *   se cobran.
 * - Por defecto se seleccionan las presupuestadas (el plan aceptado). Las
 *   pendientes y las ya realizadas sin cobro se pueden sumar a mano.
 * - «Cobrar ahora» registra cargo + pago; «Dejar a cuenta» deja solo el cargo.
 */
export function ChargePlanModal({
  patientName,
  items,
  onClose,
  onSubmit,
}: ChargePlanModalProps) {
  const chargeable = useMemo(() => getChargeableItems(items), [items])

  const defaultSelected = useMemo(() => {
    const budgeted = chargeable.filter((item) => item.status === 'budgeted')
    const chosen = budgeted.length > 0 ? budgeted : chargeable

    return chosen.reduce<Record<string, boolean>>((selection, item) => {
      selection[item.id] = true

      return selection
    }, {})
  }, [chargeable])

  const [selected, setSelected] = useState<Record<string, boolean>>(defaultSelected)
  const [collected, setCollected] = useState(true)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [receiptEnabled, setReceiptEnabled] = useState(false)
  const [receiptNumber, setReceiptNumber] = useState(() => buildReceiptSuggestion())
  const [notes, setNotes] = useState('')
  const [notesTouched, setNotesTouched] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedItems = useMemo(
    () => chargeable.filter((item) => selected[item.id]),
    [chargeable, selected],
  )

  const total = useMemo(
    () => selectedItems.reduce((sum, item) => sum + getItemAmount(item), 0),
    [selectedItems],
  )

  /** Mientras la persona no escriba, la nota describe el plan seleccionado. */
  const noteValue = notesTouched ? notes : buildChargeNote(selectedItems)
  const allSelected = chargeable.length > 0 && selectedItems.length === chargeable.length

  function toggleItem(itemId: string) {
    setError(null)
    setSelected((current) => ({ ...current, [itemId]: !current[itemId] }))
  }

  function toggleAll() {
    setError(null)

    if (allSelected) {
      setSelected({})
      return
    }

    setSelected(
      chargeable.reduce<Record<string, boolean>>((selection, item) => {
        selection[item.id] = true

        return selection
      }, {}),
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isSaving) return

    if (selectedItems.length === 0) {
      setError('Elegí al menos un procedimiento para cobrar.')
      return
    }

    if (total <= 0) {
      setError('El total del cobro es cero. Revisá el precio de las líneas elegidas.')
      return
    }

    const receipt = collected && receiptEnabled ? normalizeReceiptNumber(receiptNumber) : null

    if (collected && receiptEnabled && !receipt) {
      setError('Escribí el número de recibo o desmarcá la opción de emitirlo.')
      return
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setError('Sin conexión: no se puede registrar el cobro. Revisá tu internet.')
      return
    }

    setError(null)
    setIsSaving(true)

    try {
      await onSubmit({
        lines: selectedItems.map((item) => ({
          itemId: item.id,
          treatmentId: item.treatment_id as string,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          toothNumber: item.tooth_number,
          surface: item.surface,
        })),
        collected,
        method: collected ? method : null,
        receiptNumber: receipt,
        notes: noteValue.trim() || null,
      })
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo registrar el cobro del plan.',
      )
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isBusy={isSaving}
      onClose={onClose}
      size="lg"
      title="Cobrar el plan"
      description={`${patientName} · las líneas elegidas pasan a la caja como tratamientos realizados.`}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-500 sm:text-sm">
            Total a cobrar:{' '}
            <span className="text-base font-semibold tabular-nums text-slate-900">
              {formatPYG(total)}
            </span>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-xl border border-slate-300 bg-white/85 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="plan-charge-form"
              disabled={isSaving || selectedItems.length === 0}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSaving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {isSaving
                ? 'Registrando…'
                : collected
                  ? 'Cobrar y registrar'
                  : 'Registrar a cuenta'}
            </button>
          </div>
        </div>
      }
    >
      <form id="plan-charge-form" onSubmit={handleSubmit} className="space-y-5" noValidate>
        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-200"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <p className="flex items-start gap-2 rounded-xl bg-brand-50/70 px-3 py-2.5 text-xs leading-relaxed text-brand-900 ring-1 ring-brand-100">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Solo se cobran las líneas con precio y sin movimiento de caja; las piezas ausentes no
            se cobran. Cada línea cobrada queda enlazada a su cargo para no cobrarla dos veces.
          </span>
        </p>

        <div role="group" aria-labelledby="plan-charge-lines">
          <div className="mb-1 flex items-end justify-between gap-2">
            <p id="plan-charge-lines" className="text-sm font-medium text-slate-700">
              Procedimientos a cobrar
            </p>
            <button
              type="button"
              onClick={toggleAll}
              disabled={isSaving || chargeable.length === 0}
              className="rounded-lg px-2 py-1 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50 disabled:opacity-50"
            >
              {allSelected ? 'Quitar todos' : 'Elegir todos'}
            </button>
          </div>
          <p className="mb-2 text-[11px] text-slate-400">
            {selectedItems.length} de {chargeable.length} línea
            {chargeable.length === 1 ? '' : 's'} sin cobrar · las pendientes y las realizadas sin
            cobro también se pueden sumar.
          </p>

          {chargeable.length === 0 ? (
            <p className="rounded-xl border border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
              Este plan no tiene procedimientos con precio pendientes de cobro.
            </p>
          ) : (
            <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
              {chargeable.map((item) => {
                const status = ITEM_STATUS_META[item.status]
                const isChecked = Boolean(selected[item.id])

                return (
                  <label
                    key={item.id}
                    className={[
                      'flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors',
                      isChecked ? 'bg-brand-50/40' : 'hover:bg-slate-50',
                    ].join(' ')}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleItem(item.id)}
                      disabled={isSaving}
                      className="mt-1 size-4 shrink-0 rounded border-slate-300 accent-brand-600"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                          Pieza {item.tooth_number}
                        </span>
                        <span className="text-xs text-slate-500">
                          {getSurfaceLabel(item.surface)}
                        </span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${status.badge}`}
                        >
                          {status.shortLabel}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-sm font-medium text-slate-900">
                        {item.treatment?.name ?? 'Procedimiento'}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {item.quantity} × {formatPYG(item.unit_price)}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                      {formatPYG(getItemAmount(item))}
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        <div role="group" aria-labelledby="plan-charge-payment">
          <p id="plan-charge-payment" className={LABEL_CLASS}>
            ¿Cómo se cobra?
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setCollected(true)}
              aria-pressed={collected}
              disabled={isSaving}
              className={[
                'rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60',
                collected
                  ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-200'
                  : 'border-slate-300 bg-white/85 hover:bg-slate-50',
              ].join(' ')}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                {collected && <Check className="size-4 text-brand-600" aria-hidden="true" />}
                Cobrar ahora
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-slate-500">
                Registra el cargo y el pago: el dinero entra a caja.
              </span>
            </button>

            <button
              type="button"
              onClick={() => setCollected(false)}
              aria-pressed={!collected}
              disabled={isSaving}
              className={[
                'rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60',
                !collected
                  ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-200'
                  : 'border-slate-300 bg-white/85 hover:bg-slate-50',
              ].join(' ')}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                {!collected && <Check className="size-4 text-brand-600" aria-hidden="true" />}
                Dejar a cuenta
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-slate-500">
                Queda como deuda pendiente del paciente.
              </span>
            </button>
          </div>
        </div>

        {collected && (
          <div role="group" aria-labelledby="plan-charge-method">
            <p id="plan-charge-method" className={LABEL_CLASS}>
              Método de pago
            </p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {PAYMENT_METHOD_OPTIONS.map((option) => {
                const Icon = METHOD_ICONS[option.value]
                const isActive = method === option.value

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setMethod(option.value)}
                    aria-pressed={isActive}
                    disabled={isSaving}
                    className={[
                      'inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs font-medium transition-colors disabled:opacity-60',
                      isActive
                        ? 'border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-200'
                        : 'border-slate-300 bg-white/85 text-slate-600 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                    {option.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {collected && (
          <div className="rounded-xl border border-slate-200 p-3">
            <label htmlFor="plan-charge-receipt-enabled" className="flex items-start gap-2.5">
              <input
                id="plan-charge-receipt-enabled"
                type="checkbox"
                checked={receiptEnabled}
                onChange={(event) => setReceiptEnabled(event.target.checked)}
                disabled={isSaving}
                className="mt-0.5 size-4 rounded border-slate-300 accent-brand-600"
              />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                  <Receipt className="size-3.5 text-slate-400" aria-hidden="true" />
                  Registrar recibo
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Guarda el número de comprobante entregado al paciente.
                </span>
              </span>
            </label>

            {receiptEnabled && (
              <div className="mt-2">
                <label htmlFor="plan-charge-receipt" className="sr-only">
                  Número de recibo
                </label>
                <input
                  id="plan-charge-receipt"
                  type="text"
                  value={receiptNumber}
                  maxLength={40}
                  onChange={(event) => setReceiptNumber(event.target.value)}
                  disabled={isSaving}
                  className={`${INPUT_CLASS} font-mono text-xs uppercase`}
                />
              </div>
            )}
          </div>
        )}

        <div>
          <label htmlFor="plan-charge-notes" className={LABEL_CLASS}>
            Notas del cobro <span className="font-normal text-slate-400">(opcional)</span>
          </label>
          <textarea
            id="plan-charge-notes"
            rows={3}
            maxLength={500}
            value={noteValue}
            onChange={(event) => {
              setNotes(event.target.value)
              setNotesTouched(true)
            }}
            disabled={isSaving}
            placeholder="Observaciones del cobro, autorización del convenio, etc."
            className={`${INPUT_CLASS} resize-y`}
          />
          <p className="mt-1 text-xs text-slate-400">
            La nota describe el plan y queda en el movimiento de caja y en la historia clínica.
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">
                {selectedItems.length} línea{selectedItems.length === 1 ? '' : 's'} a cobrar
              </dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">
                {formatPYG(total)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">
                {collected ? 'Ingreso a caja' : 'Saldo del paciente'}
              </dt>
              <dd
                className={`mt-0.5 text-base font-semibold tabular-nums ${
                  collected ? 'text-emerald-700' : 'text-amber-700'
                }`}
              >
                {collected ? `+ ${formatPYG(total)}` : `+ ${formatPYG(total)} de deuda`}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            {collected
              ? 'Se registra un cargo y un pago por el total: el saldo del paciente no cambia y el ingreso queda en caja.'
              : 'Se registra solo el cargo: las líneas quedan realizadas y el importe se suma al saldo del paciente.'}
          </p>
        </div>
      </form>
    </Modal>
  )
}

