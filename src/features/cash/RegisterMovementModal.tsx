import { useMemo, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  Check,
  CreditCard,
  HandCoins,
  Loader2,
  Minus,
  MoreHorizontal,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  Stethoscope,
  X,
} from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { formatPYG } from '../../lib/format'
import { PatientPicker } from '../patients/PatientPicker'
import { patientContactLabel } from '../patients/patient-contact'
import { getPatientFullName, type Patient } from '../patients/patient-types'
import {
  BALANCE_STATE_META,
  buildReceiptSuggestion,
  formatAmountInput,
  getBalanceState,
  normalizeReceiptNumber,
  parseAmountInput,
} from './cash-format'
import {
  computeChargeTotal,
  filterTreatments,
  getBalanceAfter,
  groupTreatmentsByCategory,
  type TreatmentGroup,
} from './cash-metrics'
import { registerPayment, registerTreatmentCharge } from './cash-service'
import {
  PAYMENT_METHOD_OPTIONS,
  type ChargeItemInput,
  type MovementResult,
  type PatientBalance,
  type PaymentMethod,
} from './cash-types'
import { useTreatmentsCatalog } from './useTreatmentsCatalog'

type RegisterMovementModalProps = {
  patients: Patient[]
  /** Paciente preseleccionado desde el estado de cuenta. */
  initialPatientId?: string
  balances: PatientBalance[]
  onClose: () => void
  onSaved: (result: MovementResult, patientName: string) => void
}

type MovementKind = 'charge' | 'payment'

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

const KIND_OPTIONS: {
  value: MovementKind
  label: string
  hint: string
  icon: typeof Stethoscope
}[] = [
  {
    value: 'charge',
    label: 'Cobro de tratamiento',
    hint: 'Tratamientos del catálogo con su precio',
    icon: Stethoscope,
  },
  {
    value: 'payment',
    label: 'Abono libre',
    hint: 'Pago a cuenta del saldo del paciente',
    icon: HandCoins,
  },
]

/** El catálogo semilla está en dólares: avisamos antes de cobrar en guaraníes. */
const LOW_PRICE_THRESHOLD = 1000

export function RegisterMovementModal({
  patients,
  initialPatientId,
  balances,
  onClose,
  onSaved,
}: RegisterMovementModalProps) {
  const [kind, setKind] = useState<MovementKind>('charge')
  const [patientId, setPatientId] = useState(initialPatientId ?? '')
  const [collected, setCollected] = useState(true)
  const [selected, setSelected] = useState<Record<string, number>>({})
  const [treatmentQuery, setTreatmentQuery] = useState('')
  const [amountInput, setAmountInput] = useState('')
  const [reference, setReference] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [receiptEnabled, setReceiptEnabled] = useState(false)
  const [receiptNumber, setReceiptNumber] = useState(() => buildReceiptSuggestion())
  const [notes, setNotes] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const {
    catalog,
    isLoading: isCatalogLoading,
    error: catalogError,
    reload: reloadCatalog,
  } = useTreatmentsCatalog()

  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === patientId) ?? null,
    [patients, patientId],
  )

  const balanceByPatient = useMemo(() => {
    const map = new Map<string, number>()

    for (const balance of balances) map.set(balance.patient_id, balance.balance)

    return map
  }, [balances])

  const currentBalance = patientId ? (balanceByPatient.get(patientId) ?? 0) : 0
  const balanceState = getBalanceState(currentBalance)
  const balanceMeta = BALANCE_STATE_META[balanceState]

  const selectedItems: ChargeItemInput[] = useMemo(
    () =>
      catalog
        .filter((item) => selected[item.id])
        .map((item) => ({
          treatmentId: item.id,
          quantity: selected[item.id] ?? 1,
          unitPrice: item.default_price,
        })),
    [catalog, selected],
  )

  const chargeTotal = useMemo(() => computeChargeTotal(selectedItems), [selectedItems])
  const amount = parseAmountInput(amountInput)
  const total = kind === 'charge' ? chargeTotal : amount
  const isCollected = kind === 'payment' || collected

  const balanceAfter = getBalanceAfter(currentBalance, {
    kind,
    total,
    collected: kind === 'charge' ? collected : true,
  })

  const groups = useMemo(
    () => groupTreatmentsByCategory(filterTreatments(catalog, treatmentQuery)),
    [catalog, treatmentQuery],
  )

  const hasLowPrices = useMemo(
    () =>
      kind === 'charge' &&
      catalog.length > 0 &&
      catalog.every((item) => item.default_price < LOW_PRICE_THRESHOLD),
    [catalog, kind],
  )

  function toggleTreatment(treatmentId: string) {
    setSubmitError(null)
    setSelected((current) => {
      if (current[treatmentId]) {
        const next = { ...current }
        delete next[treatmentId]

        return next
      }

      return { ...current, [treatmentId]: 1 }
    })
  }

  function changeQuantity(treatmentId: string, delta: number) {
    setSubmitError(null)
    setSelected((current) => {
      const next = Math.max(1, Math.min(20, (current[treatmentId] ?? 1) + delta))

      return { ...current, [treatmentId]: next }
    })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    if (isSaving) return

    if (!patientId || !selectedPatient) {
      setSubmitError('Elegí el paciente del movimiento.')
      return
    }

    if (kind === 'charge' && selectedItems.length === 0) {
      setSubmitError('Elegí al menos un tratamiento del catálogo.')
      return
    }

    if (kind === 'charge' && chargeTotal <= 0) {
      setSubmitError(
        'El total del cobro es cero. Revisá el precio del tratamiento en el catálogo.',
      )
      return
    }

    if (kind === 'payment' && amount <= 0) {
      setSubmitError('Ingresá el monto del abono en guaraníes.')
      return
    }

    const receipt = receiptEnabled && isCollected ? normalizeReceiptNumber(receiptNumber) : null

    if (receiptEnabled && isCollected && !receipt) {
      setSubmitError('Escribí el número de recibo o desmarcá la opción de emitirlo.')
      return
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setSubmitError('Sin conexión: no se puede registrar el movimiento. Revisá tu internet.')
      return
    }

    setIsSaving(true)
    setSubmitError(null)

    const patientName = selectedPatient ? getPatientFullName(selectedPatient) : 'el paciente'
    const trimmedNotes = notes.trim() || null

    try {
      const result =
        kind === 'charge'
          ? await registerTreatmentCharge({
              patientId,
              items: selectedItems,
              collected,
              method: isCollected ? method : null,
              receiptNumber: receipt,
              notes: trimmedNotes,
            })
          : await registerPayment({
              patientId,
              amount,
              method,
              receiptNumber: receipt,
              notes: trimmedNotes,
              reference: reference.trim() || null,
            })

      onSaved(result, patientName)
    } catch (cause) {
      setSubmitError(
        cause instanceof Error ? cause.message : 'No se pudo registrar el movimiento de caja.',
      )
      setIsSaving(false)
    }
  }

  const submitLabel =
    kind === 'charge'
      ? collected
        ? 'Registrar cobro'
        : 'Registrar cargo'
      : 'Registrar abono'

  return (
    <Modal
      title="Registrar movimiento"
      description="Cobros de tratamiento, abonos libres y cargos a cuenta. Todos los importes se guardan en guaraníes."
      size="xl"
      isBusy={isSaving}
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-500 sm:text-sm">
            Total:{' '}
            <span className="text-base font-semibold tabular-nums text-slate-900">
              {formatPYG(total)}
            </span>
          </div>
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
              form="cash-movement-form"
              disabled={isSaving}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSaving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {isSaving ? 'Guardando…' : submitLabel}
            </button>
          </div>
        </div>
      }
    >
      <form id="cash-movement-form" onSubmit={handleSubmit} className="space-y-5" noValidate>
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
                  {getPatientFullName(selectedPatient)}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {patientContactLabel(selectedPatient) || 'Sin documento ni teléfono'}
                </p>
                <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-slate-500">Saldo actual:</span>
                  <span className={`font-semibold tabular-nums ${balanceMeta.amount}`}>
                    {formatPYG(Math.abs(currentBalance))}
                  </span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${balanceMeta.badge}`}
                  >
                    {balanceMeta.label}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setPatientId('')
                  setSubmitError(null)
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
              disabled={isSaving}
              idPrefix="cash-patient"
              onSelect={(patient) => {
                setPatientId(patient.id)
                setSubmitError(null)
              }}
            />
          )}
        </fieldset>

        <fieldset>
          <legend className={LABEL_CLASS}>Tipo de movimiento</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {KIND_OPTIONS.map((option) => {
              const Icon = option.icon
              const isActive = kind === option.value

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setKind(option.value)
                    setSubmitError(null)
                  }}
                  aria-pressed={isActive}
                  disabled={isSaving}
                  className={[
                    'flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-60',
                    isActive
                      ? 'border-brand-500 bg-brand-50/70 ring-1 ring-brand-200'
                      : 'border-slate-300 bg-white/85 hover:bg-slate-50',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
                      isActive ? 'bg-brand-500 text-ink-950 shadow-sm ring-1 ring-brand-600/25' : 'bg-slate-100 text-slate-500',
                    ].join(' ')}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-slate-500">
                      {option.hint}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </fieldset>


        {kind === 'charge' ? (
          <fieldset>
            <legend className={LABEL_CLASS}>Tratamientos del catálogo</legend>
            <p className="mb-2 text-[11px] font-medium text-slate-400">
              {selectedItems.length} seleccionado{selectedItems.length === 1 ? '' : 's'}
            </p>

            {hasLowPrices && (
              <p className="mb-2 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-200">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                Los precios del catálogo son muy bajos para guaraníes. Verificá la tabla{' '}
                <span className="font-semibold">treatments</span> antes de cobrar.
              </p>
            )}

            {catalogError ? (
              <div className="rounded-xl border border-slate-200 px-3 py-4 text-center">
                <p className="text-sm text-slate-500">{catalogError}</p>
                <button
                  type="button"
                  onClick={reloadCatalog}
                  className="mt-2 rounded-lg border border-slate-300 bg-white/85 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Reintentar
                </button>
              </div>
            ) : isCatalogLoading ? (
              <p className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-4 text-sm text-slate-500">
                <Loader2 className="size-4 animate-spin text-brand-600" aria-hidden="true" />
                Cargando el catálogo de tratamientos…
              </p>
            ) : (
              <TreatmentSelector
                groups={groups}
                selected={selected}
                query={treatmentQuery}
                onQueryChange={setTreatmentQuery}
                onToggle={toggleTreatment}
              />
            )}

            {selectedItems.length > 0 && (
              <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
                {selectedItems.map((item) => {
                  const catalogItem = catalog.find((entry) => entry.id === item.treatmentId)
                  const name = catalogItem?.name ?? 'Tratamiento'
                  const lineTotal = Math.round(item.quantity * item.unitPrice)

                  return (
                    <li
                      key={item.treatmentId}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{name}</p>
                        <p className="text-xs text-slate-500">{formatPYG(item.unitPrice)} c/u</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="inline-flex items-center rounded-lg border border-slate-300 bg-white/85">
                          <button
                            type="button"
                            onClick={() => changeQuantity(item.treatmentId, -1)}
                            disabled={isSaving || item.quantity <= 1}
                            aria-label={`Quitar una unidad de ${name}`}
                            className="rounded-l-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-40"
                          >
                            <Minus className="size-3.5" aria-hidden="true" />
                          </button>
                          <span className="w-7 text-center text-sm font-semibold tabular-nums text-slate-900">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => changeQuantity(item.treatmentId, 1)}
                            disabled={isSaving || item.quantity >= 20}
                            aria-label={`Agregar una unidad de ${name}`}
                            className="rounded-r-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-40"
                          >
                            <Plus className="size-3.5" aria-hidden="true" />
                          </button>
                        </div>

                        <span className="w-24 text-right text-sm font-semibold tabular-nums text-slate-900">
                          {formatPYG(lineTotal)}
                        </span>

                        <button
                          type="button"
                          onClick={() => toggleTreatment(item.treatmentId)}
                          disabled={isSaving}
                          aria-label={`Quitar ${name} del cobro`}
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                        >
                          <X className="size-4" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
              <span className="text-slate-500">Total de tratamientos</span>
              <span className="font-semibold tabular-nums text-slate-900">
                {formatPYG(chargeTotal)}
              </span>
            </div>
          </fieldset>
        ) : (


          <fieldset>
            <legend className={LABEL_CLASS}>Monto del abono</legend>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">
                ₲
              </span>
              <input
                id="cash-amount"
                inputMode="numeric"
                autoComplete="off"
                value={amountInput}
                onChange={(event) => {
                  setAmountInput(formatAmountInput(event.target.value))
                  setSubmitError(null)
                }}
                disabled={isSaving}
                placeholder="0"
                className={`${INPUT_CLASS} pl-8 pr-28 text-lg font-semibold tabular-nums`}
              />
              {currentBalance > 0 && (
                <button
                  type="button"
                  onClick={() => setAmountInput(formatAmountInput(String(Math.round(currentBalance))))}
                  disabled={isSaving}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border border-slate-300 bg-white/85 px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Usar saldo
                </button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Saldo actual: {formatPYG(Math.abs(currentBalance))} ({balanceMeta.label.toLowerCase()}).
              El abono se descuenta del saldo.
            </p>

            <div className="mt-3">
              <label htmlFor="cash-reference" className={LABEL_CLASS}>
                Concepto <span className="font-normal text-slate-400">(opcional)</span>
              </label>
              <input
                id="cash-reference"
                type="text"
                maxLength={80}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                disabled={isSaving}
                placeholder="Abono a cuenta"
                className={INPUT_CLASS}
              />
            </div>
          </fieldset>
        )}

        {kind === 'charge' && (
          <fieldset>
            <legend className={LABEL_CLASS}>¿Se cobra ahora?</legend>
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
                  Cobrado ahora
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
                  A cuenta
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-slate-500">
                  Queda como deuda pendiente del paciente.
                </span>
              </button>
            </div>
          </fieldset>
        )}


        {isCollected && (
          <fieldset>
            <legend className={LABEL_CLASS}>Método de pago</legend>
            <div className="grid gap-1.5 sm:grid-cols-3">
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
          </fieldset>
        )}

        {isCollected && (
          <div className="rounded-xl border border-slate-200 p-3">
            <label htmlFor="cash-receipt-enabled" className="flex items-start gap-2.5">
              <input
                id="cash-receipt-enabled"
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
                <label htmlFor="cash-receipt" className="sr-only">
                  Número de recibo
                </label>
                <input
                  id="cash-receipt"
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
          <label htmlFor="cash-notes" className={LABEL_CLASS}>
            Notas <span className="font-normal text-slate-400">(opcional)</span>
          </label>
          <textarea
            id="cash-notes"
            rows={2}
            maxLength={300}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={isSaving}
            placeholder="Observaciones del cobro, autorización del convenio, etc."
            className={`${INPUT_CLASS} resize-y`}
          />
        </div>


        <div className="rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-slate-500">Total del movimiento</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums text-slate-900">
                {formatPYG(total)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Saldo resultante</dt>
              <dd className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <span
                  className={`text-base font-semibold tabular-nums ${
                    BALANCE_STATE_META[getBalanceState(balanceAfter)].amount
                  }`}
                >
                  {formatPYG(Math.abs(balanceAfter))}
                </span>
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${
                    BALANCE_STATE_META[getBalanceState(balanceAfter)].badge
                  }`}
                >
                  {BALANCE_STATE_META[getBalanceState(balanceAfter)].label}
                </span>
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            {kind === 'charge'
              ? collected
                ? 'El cargo y el pago se compensan: el saldo del paciente no cambia y el ingreso queda en caja.'
                : 'El cargo se suma al saldo del paciente y queda pendiente de cobro.'
              : 'El abono reduce el saldo pendiente del paciente.'}
          </p>
        </div>
      </form>
    </Modal>
  )
}

type TreatmentSelectorProps = {
  groups: TreatmentGroup[]
  selected: Record<string, number>
  query: string
  onQueryChange: (value: string) => void
  onToggle: (treatmentId: string) => void
}

/** Catálogo agrupado por categoría, con búsqueda y selección múltiple. */
function TreatmentSelector({
  groups,
  selected,
  query,
  onQueryChange,
  onToggle,
}: TreatmentSelectorProps) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <label htmlFor="cash-treatment-search" className="sr-only">
          Buscar tratamiento por nombre o código
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          id="cash-treatment-search"
          type="text"
          role="searchbox"
          autoComplete="off"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Buscar tratamiento por nombre o código…"
          className={`${INPUT_CLASS} pl-9`}
        />
      </div>

      <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200">
        {groups.length === 0 ? (
          <p className="px-3 py-4 text-sm text-slate-500">
            No encontramos tratamientos con esa búsqueda.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.category} aria-label={group.category}>
              <h4 className="sticky top-0 z-10 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 capitalize">
                {group.category}
              </h4>

              <ul className="divide-y divide-slate-100">
                {group.items.map((item) => {
                  const isSelected = Boolean(selected[item.id])

                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => onToggle(item.id)}
                        aria-pressed={isSelected}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-brand-50/50"
                      >
                        <span className="flex min-w-0 items-start gap-2">
                          <span
                            className={[
                              'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
                              isSelected
                                ? 'border-brand-600 bg-brand-500 text-ink-950'
                                : 'border-slate-300 bg-white/85',
                            ].join(' ')}
                          >
                            {isSelected && <Check className="size-3" aria-hidden="true" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-slate-900">
                              {item.name}
                            </span>
                            <span className="block text-[11px] text-slate-500">
                              {item.code} · {item.default_duration_minutes} min
                            </span>
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-medium tabular-nums text-slate-700">
                          {formatPYG(item.default_price)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  )
}

