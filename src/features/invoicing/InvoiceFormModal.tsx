import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Check,
  Hash,
  Link2,
  Loader2,
  Lock,
  Receipt,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { formatPYG, formatPYGInput, formatShortDate, parsePYGInput } from '../../lib/format'
import { PatientPicker } from '../patients/PatientPicker'
import { getPatientFullName, type Patient } from '../patients/patient-types'
import { PAYMENT_METHOD_OPTIONS, type PaymentMethod } from '../cash/cash-types'
import {
  autoFormatRuc,
  buildCdcPreview,
  buildInvoiceNumber,
  formatInvoiceNumberInput,
  getNextSequenceNumber,
  getTodayKey,
  isValidRuc,
  parseInvoiceNumberInput,
  RUC_FORMAT_HINT,
} from './invoicing-format'
import { fetchNextTimbradoSequence, issueInvoice } from './invoicing-service'
import { computeInvoiceBreakdown } from './invoicing-tax'
import {
  TIMBRADO_MODE_LABELS,
  TIMBRADO_MODE_OPTIONS,
  VAT_RATE_LABELS,
  VAT_RATE_OPTIONS,
  getIssuerName,
  getIssuerTimbrados,
  getSelectableTimbrados,
  getTimbradoLabel,
  getTimbradoRangeLabel,
  isAutomaticNumbering,
  suggestIssuer,
  type Invoice,
  type TaxIssuer,
  type VatRate,
} from './invoicing-types'
import { RucLookupField } from './RucLookupField'
import { useInvoicing } from './useInvoicing'

const INPUT_CLASS =
  'w-full rounded-xl border border-slate-300 bg-white/85 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500'

const LABEL_CLASS = 'mb-1 block text-sm font-medium text-slate-700'

const HELP_CLASS = 'mt-1 text-xs leading-relaxed text-slate-400'

const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white/85 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50'

/** Datos del cobro que originan la factura (caja, odontograma o manual). */
export type InvoiceSeed = {
  patientId?: string | null
  patientName?: string | null
  /** Importe total con IVA incluido. */
  amount?: number
  /** Profesional que atendió: se usa para sugerir el emisor. */
  dentistId?: string | null
  transactionId?: string | null
  note?: string | null
}

type InvoiceFormModalProps = {
  patients: Patient[]
  seed?: InvoiceSeed
  onClose: () => void
  onIssued: (invoice: Invoice) => void
}

/**
 * Emisión de una factura legal paraguaya.
 *
 * Reglas que aplica el formulario:
 * - `multi_issuer`: se elige el emisor; se preselecciona el del profesional que
 *   atendió el tratamiento (o el predeterminado de la clínica).
 * - `single_company`: el emisor está fijado por la configuración.
 * - Al cambiar de emisor se cargan sus timbrados vigentes y el número se arma
 *   según la modalidad (manual, preimpreso con caída, autoimpresor o
 *   electrónica con CDC).
 * - El IVA se despeja del importe (10 % ÷ 11, 5 % ÷ 21, exenta).
 */
export function InvoiceFormModal({
  patients,
  seed,
  onClose,
  onIssued,
}: InvoiceFormModalProps) {
  const { settings, issuers, timbrados, isLoading, error, reload } = useInvoicing()
  const todayKey = useMemo(() => getTodayKey(), [])

  const activeIssuers = useMemo(
    () => issuers.filter((issuer) => issuer.is_active),
    [issuers],
  )

  const seedPatient = useMemo(
    () => patients.find((patient) => patient.id === seed?.patientId) ?? null,
    [patients, seed?.patientId],
  )

  const [issuerChoice, setIssuerChoice] = useState('')
  const [timbradoChoice, setTimbradoChoice] = useState('')
  const [numberDraft, setNumberDraft] = useState<string | null>(null)
  const [freshStep, setFreshStep] = useState<{
    timbradoId: string
    sequence: number | null
  } | null>(null)

  const [patientId, setPatientId] = useState(seed?.patientId ?? '')
  const [customerName, setCustomerName] = useState(() =>
    seedPatient ? getPatientFullName(seedPatient) : (seed?.patientName ?? ''),
  )

  const seedIsRuc = seedPatient?.document_type === 'RUC'
  const [customerRuc, setCustomerRuc] = useState(
    seedIsRuc ? autoFormatRuc(seedPatient?.document_number ?? '') : '',
  )
  const [customerDocument, setCustomerDocument] = useState(
    seedIsRuc ? '' : (seedPatient?.document_number ?? ''),
  )
  const [customerEmail, setCustomerEmail] = useState(seedPatient?.email ?? '')
  const [customerAddress, setCustomerAddress] = useState(seedPatient?.address ?? '')

  const [vatRate, setVatRate] = useState<VatRate>('iva_10')
  const [amountInput, setAmountInput] = useState(() =>
    seed?.amount && seed.amount > 0 ? formatPYGInput(String(seed.amount)) : '',
  )
  const [method, setMethod] = useState<PaymentMethod | ''>('cash')
  const [notes, setNotes] = useState(seed?.note ?? '')

  const [isSaving, setIsSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  /** Emisor resuelto: el elegido o el sugerido por modo/dentista. */
  const issuer: TaxIssuer | null = useMemo(() => {
    const chosen = activeIssuers.find((item) => item.id === issuerChoice)

    if (chosen) return chosen

    return suggestIssuer(settings, activeIssuers, seed?.dentistId)
  }, [activeIssuers, issuerChoice, seed?.dentistId, settings])

  const selectableTimbrados = useMemo(
    () => getSelectableTimbrados(timbrados, issuer?.id ?? null, todayKey),
    [issuer?.id, timbrados, todayKey],
  )

  const timbrado = useMemo(
    () =>
      selectableTimbrados.find((item) => item.id === timbradoChoice) ??
      selectableTimbrados[0] ??
      null,
    [selectableTimbrados, timbradoChoice],
  )

  // Correlativo fresco: la base es la autoridad cuando dos personas facturan a
  // la vez. Si la consulta falla se usa el `last_number` ya cargado.
  useEffect(() => {
    if (!timbrado) return

    const timbradoId = timbrado.id
    let isCurrent = true

    fetchNextTimbradoSequence(timbradoId)
      .then((sequence) => {
        if (isCurrent) setFreshStep({ timbradoId, sequence })
      })
      .catch(() => {
        if (isCurrent) setFreshStep(null)
      })

    return () => {
      isCurrent = false
    }
  }, [timbrado])

  const suggestedSequence = useMemo(() => {
    if (!timbrado) return null
    if (freshStep?.timbradoId === timbrado.id) return freshStep.sequence

    return getNextSequenceNumber(timbrado)
  }, [freshStep, timbrado])

  const suggestedNumber = useMemo(() => {
    if (!timbrado || suggestedSequence === null) return null

    return buildInvoiceNumber(
      timbrado.establishment,
      timbrado.emission_point,
      suggestedSequence,
    )
  }, [suggestedSequence, timbrado])

  const numberValue = numberDraft ?? suggestedNumber ?? ''
  const amount = parsePYGInput(amountInput)
  const breakdown = useMemo(
    () => computeInvoiceBreakdown(amount, vatRate),
    [amount, vatRate],
  )

  const automaticNumber = timbrado ? isAutomaticNumbering(timbrado.mode) : false

  const cdcPreview = useMemo(() => {
    if (!timbrado || !issuer || timbrado.mode !== 'electronic') return null

    const sequence = automaticNumber
      ? suggestedSequence
      : parseInvoiceNumberInput(numberValue).sequence

    if (!sequence) return null

    return buildCdcPreview({
      ruc: issuer.ruc,
      establishment: timbrado.establishment,
      emissionPoint: timbrado.emission_point,
      sequence,
      issuedOn: todayKey,
      taxpayerKind: issuer.kind,
      timbradoNumber: timbrado.timbrado_number,
    })
  }, [automaticNumber, issuer, numberValue, suggestedSequence, timbrado, todayKey])

  const issuerTimbradoCount = getIssuerTimbrados(timbrados, issuer?.id ?? null).length
  const multiIssuer = settings?.operational_mode === 'multi_issuer'
  const missingIssuer = !isLoading && !error && activeIssuers.length === 0
  const noTimbrado =
    Boolean(issuer) && !isLoading && !error && selectableTimbrados.length === 0

  function selectPatient(patient: Patient) {
    setPatientId(patient.id)
    setCustomerName(getPatientFullName(patient))
    setCustomerEmail(patient.email ?? '')
    setCustomerAddress(patient.address ?? '')
    setCustomerRuc(
      patient.document_type === 'RUC' ? autoFormatRuc(patient.document_number ?? '') : '',
    )
    setCustomerDocument(
      patient.document_type === 'RUC' ? '' : (patient.document_number ?? ''),
    )
  }

  function changeIssuer(nextIssuerId: string) {
    setIssuerChoice(nextIssuerId)
    setTimbradoChoice('')
    setNumberDraft(null)
    setFreshStep(null)
    setSubmitError(null)
  }

  function changeTimbrado(nextTimbradoId: string) {
    setTimbradoChoice(nextTimbradoId)
    setNumberDraft(null)
    setFreshStep(null)
    setSubmitError(null)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    if (!timbrado) {
      setSubmitError('Elegí el timbrado con el que se emite la factura.')
      return
    }

    let sequenceNumber: number | null = null

    if (!automaticNumber) {
      const parts = parseInvoiceNumberInput(numberValue)

      if (!parts.isComplete) {
        setSubmitError('Completá el número con la máscara 000-000-0000000.')
        return
      }
      if (
        parts.establishment !== timbrado.establishment ||
        parts.emissionPoint !== timbrado.emission_point
      ) {
        setSubmitError(
          `El número debe pertenecer al establecimiento ${timbrado.establishment} y al punto de expedición ${timbrado.emission_point}.`,
        )
        return
      }

      sequenceNumber = parts.sequence
    }

    const formattedRuc = autoFormatRuc(customerRuc)

    if (formattedRuc && !isValidRuc(formattedRuc)) {
      setSubmitError(`Revisá el RUC del cliente: ${RUC_FORMAT_HINT}.`)
      return
    }

    setIsSaving(true)
    setSubmitError(null)

    try {
      const invoice = await issueInvoice({
        timbradoId: timbrado.id,
        sequenceNumber,
        customer: {
          name: customerName,
          ruc: formattedRuc,
          document: customerDocument,
          email: customerEmail,
          address: customerAddress,
        },
        patientId: patientId || null,
        transactionId: seed?.transactionId ?? null,
        amount,
        vatRate,
        paymentMethod: method || null,
        cdc: timbrado.mode === 'electronic' ? cdcPreview : null,
        notes,
      })

      onIssued(invoice)
    } catch (cause) {
      setSubmitError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo emitir la factura. Intentá de nuevo.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  const timbradoModeHint = timbrado
    ? (TIMBRADO_MODE_OPTIONS.find((option) => option.value === timbrado.mode)?.numberHint ?? '')
    : ''

  return (
    <Modal
      title="Emitir factura"
      description="Comprobante legal con IVA desglosado en guaraníes."
      size="lg"
      onClose={onClose}
      isBusy={isSaving}
      footer={
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-slate-500">
            {timbrado
              ? `${TIMBRADO_MODE_LABELS[timbrado.mode]} · ${numberValue || 'sin número'}`
              : 'Sin timbrado seleccionado'}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className={SECONDARY_BUTTON_CLASS}
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="invoice-form"
              disabled={isSaving || !timbrado}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Receipt className="size-4" aria-hidden="true" />
              )}
              {isSaving ? 'Emitiendo…' : 'Emitir factura'}
            </button>
          </div>
        </div>
      }
    >
      {isLoading ? (
        <p className="flex items-center gap-2 py-10 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Cargando emisores y timbrados…
        </p>
      ) : error ? (
        <div className="py-6">
          <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-200">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
          <button
            type="button"
            onClick={reload}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white/85 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Reintentar
          </button>
        </div>
      ) : (
        <form id="invoice-form" onSubmit={handleSubmit} className="space-y-5">
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Emisor</h3>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                <ShieldCheck className="size-3" aria-hidden="true" />
                {multiIssuer ? 'Multi-emisor' : 'Modo empresa'}
              </span>
            </div>

            {multiIssuer ? (
              <select
                id="invoice-issuer"
                value={issuer?.id ?? ''}
                onChange={(event) => changeIssuer(event.target.value)}
                disabled={isSaving || activeIssuers.length === 0}
                className={INPUT_CLASS}
                aria-label="Emisor de la factura"
              >
                {activeIssuers.length === 0 && <option value="">Sin emisores activos</option>}
                {activeIssuers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.display_name} · RUC {item.ruc}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-slate-600 ring-1 ring-slate-200">
                  <Building2 className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {issuer ? getIssuerName(issuer) : 'Sin emisor predeterminado'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {issuer ? `RUC ${issuer.ruc}` : 'Configurá el emisor de la clínica'}
                  </p>
                </div>
              </div>
            )}
          </section>

          {multiIssuer && issuer?.linked_user_id && issuer.linked_user_id === seed?.dentistId && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-700">
              <Check className="size-3.5" aria-hidden="true" />
              Emisor sugerido por el profesional que realizó el tratamiento.
            </p>
          )}

          {missingIssuer && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              No hay emisores activos. Cargá al menos un emisor con su RUC en Facturación →
              Configuración antes de emitir comprobantes.
            </p>
          )}

          {noTimbrado ? (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {issuerTimbradoCount > 0
                ? 'El emisor tiene timbrados cargados, pero ninguno está activo, vigente y con números disponibles.'
                : 'Este emisor todavía no tiene timbrados. Cargalos en Facturación → Configuración.'}
            </p>
          ) : (
            timbrado && (
              <section className="space-y-3">
                <div>
                  <label htmlFor="invoice-timbrado" className={LABEL_CLASS}>
                    Timbrado
                  </label>
                  <select
                    id="invoice-timbrado"
                    value={timbrado.id}
                    onChange={(event) => changeTimbrado(event.target.value)}
                    disabled={isSaving || selectableTimbrados.length <= 1}
                    className={INPUT_CLASS}
                  >
                    {selectableTimbrados.map((item) => (
                      <option key={item.id} value={item.id}>
                        {getTimbradoLabel(item)} · {TIMBRADO_MODE_LABELS[item.mode]}
                      </option>
                    ))}
                  </select>
                  <p className={HELP_CLASS}>
                    Rango {getTimbradoRangeLabel(timbrado)} ·{' '}
                    {timbrado.valid_until
                      ? `vence el ${formatShortDate(timbrado.valid_until)}`
                      : 'sin vencimiento'}
                  </p>
                </div>

                <div>
                  <label htmlFor="invoice-number" className={LABEL_CLASS}>
                    Número de factura
                  </label>
                  <div className="relative">
                    <Hash
                      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <input
                      id="invoice-number"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={numberValue}
                      onChange={(event) =>
                        setNumberDraft(formatInvoiceNumberInput(event.target.value))
                      }
                      disabled={isSaving || automaticNumber}
                      placeholder="000-000-0000000"
                      className={`${INPUT_CLASS} pl-9 pr-9 font-mono tracking-wide`}
                      aria-describedby="invoice-number-help"
                    />
                    {automaticNumber && (
                      <Lock
                        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <p id="invoice-number-help" className={HELP_CLASS}>
                    {timbradoModeHint}
                    {automaticNumber
                      ? ' Lo asigna la base al emitir para evitar números repetidos.'
                      : ' La máscara es 000-000-0000000 (establecimiento, punto y correlativo).'}
                  </p>
                </div>
              </section>
            )
          )}

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Cliente</h3>

            <PatientPicker
              patients={patients}
              onSelect={selectPatient}
              disabled={isSaving}
              idPrefix="invoice-customer"
              maxResults={5}
              emptyListHint="Todavía no hay fichas: completá los datos del cliente a mano."
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="invoice-customer-name" className={LABEL_CLASS}>
                  Nombre o razón social
                </label>
                <input
                  id="invoice-customer-name"
                  type="text"
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  disabled={isSaving}
                  maxLength={160}
                  required
                  placeholder="Cliente / empresa"
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <RucLookupField
                  id="invoice-customer-ruc"
                  label={
                    <>
                      RUC <span className="font-normal text-slate-400">(opcional)</span>
                    </>
                  }
                  value={customerRuc}
                  onChange={setCustomerRuc}
                  onResolved={(found) => {
                    if (!customerName.trim()) setCustomerName(found.name)
                  }}
                  disabled={isSaving}
                  placeholder="80012345-6"
                />
              </div>

              <div>
                <label htmlFor="invoice-customer-document" className={LABEL_CLASS}>
                  C.I. <span className="font-normal text-slate-400">(opcional)</span>
                </label>
                <input
                  id="invoice-customer-document"
                  type="text"
                  value={customerDocument}
                  onChange={(event) =>
                    setCustomerDocument(
                      event.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 20),
                    )
                  }
                  disabled={isSaving}
                  placeholder="1234567"
                  className={`${INPUT_CLASS} font-mono`}
                />
              </div>

              <div>
                <label htmlFor="invoice-customer-email" className={LABEL_CLASS}>
                  Email <span className="font-normal text-slate-400">(opcional)</span>
                </label>
                <input
                  id="invoice-customer-email"
                  type="email"
                  value={customerEmail}
                  onChange={(event) => setCustomerEmail(event.target.value)}
                  disabled={isSaving}
                  maxLength={160}
                  placeholder="cliente@correo.com"
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <label htmlFor="invoice-customer-address" className={LABEL_CLASS}>
                  Dirección <span className="font-normal text-slate-400">(opcional)</span>
                </label>
                <input
                  id="invoice-customer-address"
                  type="text"
                  value={customerAddress}
                  onChange={(event) => setCustomerAddress(event.target.value)}
                  disabled={isSaving}
                  maxLength={200}
                  placeholder="Asunción, Paraguay"
                  className={INPUT_CLASS}
                />
              </div>
            </div>

            <p className={HELP_CLASS}>
              Con RUC la factura se emite a nombre de la empresa; sin RUC queda como consumidor
              final. Elegir una ficha del buscador copia sus datos fiscales.
            </p>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Importe e IVA</h3>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="invoice-amount" className={LABEL_CLASS}>
                  Importe total{' '}
                  <span className="font-normal text-slate-400">(IVA incluido)</span>
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
                    ₲
                  </span>
                  <input
                    id="invoice-amount"
                    type="text"
                    inputMode="numeric"
                    value={amountInput}
                    onChange={(event) => setAmountInput(formatPYGInput(event.target.value))}
                    disabled={isSaving}
                    placeholder="0"
                    className={`${INPUT_CLASS} pl-8 text-right font-mono text-base tabular-nums`}
                  />
                </div>
              </div>

              <div>
                <span className={LABEL_CLASS}>Tratamiento fiscal</span>
                <div
                  className="flex gap-1.5"
                  role="group"
                  aria-label="Tratamiento fiscal del IVA"
                >
                  {VAT_RATE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setVatRate(option.value)}
                      disabled={isSaving}
                      aria-pressed={vatRate === option.value}
                      title={option.detail}
                      className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                        vatRate === option.value
                          ? 'bg-brand-500 text-ink-950 ring-1 ring-brand-600/30'
                          : 'bg-white/85 text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className={HELP_CLASS}>
                  {VAT_RATE_OPTIONS.find((option) => option.value === vatRate)?.detail ?? ''}
                </p>
              </div>
            </div>

            <dl className="grid gap-3 rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200 sm:grid-cols-3">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                  Base imponible
                </dt>
                <dd className="mt-0.5 font-mono text-sm tabular-nums text-slate-900">
                  {formatPYG(breakdown.netTotal)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                  {VAT_RATE_LABELS[vatRate]}
                </dt>
                <dd className="mt-0.5 font-mono text-sm tabular-nums text-brand-700">
                  {formatPYG(breakdown.ivaTotal)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                  Total factura
                </dt>
                <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900">
                  {formatPYG(breakdown.total)}
                </dd>
              </div>
            </dl>

            <p className={HELP_CLASS}>
              El IVA se despeja del importe (10 % ÷ 11, 5 % ÷ 21) y el total coincide con el cobro.
              Las operaciones exentas no llevan IVA.
            </p>

            {cdcPreview && (
              <div className="rounded-xl bg-indigo-50 px-3 py-2.5 text-xs text-indigo-900 ring-1 ring-indigo-200">
                <p className="font-semibold">CDC (vista previa)</p>
                <p className="mt-0.5 break-all font-mono text-[11px] leading-relaxed">
                  {cdcPreview}
                </p>
                <p className="mt-1 text-indigo-700">
                  Referencia de 44 dígitos con dígito verificador; el CDC definitivo lo asigna el
                  SIFEN al firmar el XML.
                </p>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Cobro y observaciones</h3>

            <div>
              <label htmlFor="invoice-method" className={LABEL_CLASS}>
                Forma de pago
              </label>
              <select
                id="invoice-method"
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
              <label htmlFor="invoice-notes" className={LABEL_CLASS}>
                Observaciones <span className="font-normal text-slate-400">(opcional)</span>
              </label>
              <textarea
                id="invoice-notes"
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={isSaving}
                maxLength={500}
                placeholder="Detalle del tratamiento, número de orden, etc."
                className={`${INPUT_CLASS} resize-none`}
              />
            </div>

            {seed?.transactionId && (
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <Link2 className="size-3.5" aria-hidden="true" />
                La factura queda vinculada al movimiento de caja que originó el cobro.
              </p>
            )}
          </section>

          {submitError && (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-200"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {submitError}
            </p>
          )}
        </form>
      )}
    </Modal>
  )
}

