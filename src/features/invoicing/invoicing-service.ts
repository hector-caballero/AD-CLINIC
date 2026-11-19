import { supabase } from '../../lib/supabase'
import type { PaymentMethod, TransactionStatus, TransactionType } from '../cash/cash-types'
import { autoFormatRuc, isValidRuc, RUC_FORMAT_HINT } from './invoicing-format'
import { toInvoicingError } from './invoicing-errors'
import type { InstallmentDraft } from './invoicing-payments'
import { computeInvoiceBreakdown, computeVatBreakdown } from './invoicing-tax'
import {
  CLINIC_TAX_SETTINGS_SELECT,
  EXPENSE_INVOICE_SELECT,
  INVOICE_SELECT,
  INSTALLMENT_SELECT,
  PAYMENT_ALLOCATION_SELECT,
  TAX_ISSUER_SELECT,
  TIMBRADO_SELECT,
  getInvoicePaymentState,
  type ClinicTaxSettings,
  type ExpenseInvoice,
  type Invoice,
  type InvoiceCashPaymentInput,
  type InvoiceCondition,
  type InvoiceInstallment,
  type InvoiceIssuerRef,
  type InvoicePaymentAllocation,
  type InvoicePaymentAllocationInput,
  type InvoiceTimbradoRef,
  type InvoicingTimbrado,
  type OperationalMode,
  type TaxIssuer,
  type TaxIssuerKind,
  type TimbradoMode,
  type VatRate,
} from './invoicing-types'

/**
 * Acceso al módulo de facturación y gastos.
 *
 * - `clinic_tax_settings` es una fila única (`id = 1`): modo operativo y emisor
 *   predeterminado.
 * - `tax_issuers` / `invoicing_timbrados`: configuración fiscal editable.
 * - `invoices`: se emiten **siempre** con la función `issue_invoice`, que
 *   resuelve y valida el correlativo dentro de una transacción.
 * - `expense_invoices`: altas, ediciones y bajas directas (no tienen
 *   numeración fiscal propia).
 */

/** Topes de las listas (el `db-max-rows` de Supabase es 1000). */
export const INVOICES_LIMIT = 500
export const EXPENSES_LIMIT = 500
export const ISSUERS_LIMIT = 200
export const TIMBRADOS_LIMIT = 500

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(parsed) ? parsed : 0
}

/** PostgREST devuelve la relación como objeto; se tolera también el arreglo. */
function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null

  return Array.isArray(value) ? (value[0] ?? null) : value
}

/** Igual que `firstOf`, pero para las relaciones que siempre son listas. */
function firstOfArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return []

  return Array.isArray(value) ? value : [value]
}

function normalizeInstallment(row: InvoiceInstallment): InvoiceInstallment {
  return {
    ...row,
    number: toNumber(row.number),
    amount: toNumber(row.amount),
    paid_amount: toNumber(row.paid_amount),
  }
}

function normalizeInvoice(row: Invoice): Invoice {
  const total = toNumber(row.total)
  const paidAmount = toNumber(row.paid_amount)
  const installments = firstOfArray(row.installments).map(normalizeInstallment)

  return {
    ...row,
    sequence_number: toNumber(row.sequence_number),
    amount_10: toNumber(row.amount_10),
    amount_5: toNumber(row.amount_5),
    amount_exempt: toNumber(row.amount_exempt),
    iva_10: toNumber(row.iva_10),
    iva_5: toNumber(row.iva_5),
    total,
    installments_count: toNumber(row.installments_count) || 1,
    paid_amount: paidAmount,
    balance:
      row.balance === null || row.balance === undefined
        ? Math.max(total - paidAmount, 0)
        : toNumber(row.balance),
    payment_status:
      row.payment_status ??
      getInvoicePaymentState({ total, paid_amount: paidAmount, status: row.status }),
    issuer: firstOf(row.issuer as InvoiceIssuerRef | InvoiceIssuerRef[] | null),
    timbrado: firstOf(row.timbrado as InvoiceTimbradoRef | InvoiceTimbradoRef[] | null),
    installments: installments.sort((left, right) => left.number - right.number),
  }
}

function normalizeExpense(row: ExpenseInvoice): ExpenseInvoice {
  return {
    ...row,
    amount_10: toNumber(row.amount_10),
    amount_5: toNumber(row.amount_5),
    amount_exempt: toNumber(row.amount_exempt),
    iva_10: toNumber(row.iva_10),
    iva_5: toNumber(row.iva_5),
    total: toNumber(row.total),
    attributed_issuer: firstOf(
      row.attributed_issuer as InvoiceIssuerRef | InvoiceIssuerRef[] | null,
    ),
  }
}

function asArray<T>(data: unknown): T[] {
  return (data ?? []) as T[]
}

/**
 * `.single()` sobre tablas sin tipos generados devuelve una unión con
 * `GenericStringError`; el error ya se validó antes de llegar acá.
 */
function asRow<T>(data: unknown): T {
  return data as T
}


// -----------------------------------------------------------------------------
// Configuración de la clínica
// -----------------------------------------------------------------------------

export async function fetchClinicTaxSettings(): Promise<ClinicTaxSettings | null> {
  const { data, error } = await supabase
    .from('clinic_tax_settings')
    .select(CLINIC_TAX_SETTINGS_SELECT)
    .eq('id', 1)
    .maybeSingle()

  if (error) throw toInvoicingError(error)

  return (data as ClinicTaxSettings | null) ?? null
}

export type ClinicTaxSettingsInput = {
  operational_mode: OperationalMode
  default_issuer_id: string | null
  legal_name: string | null
  ruc: string | null
  address: string | null
  phone: string | null
  email: string | null
  occasional_customer_name: string | null
  occasional_customer_ruc: string | null
}

export async function saveClinicTaxSettings(
  input: ClinicTaxSettingsInput,
): Promise<ClinicTaxSettings> {
  const { data, error } = await supabase
    .from('clinic_tax_settings')
    .upsert({ id: 1, ...input }, { onConflict: 'id' })
    .select(CLINIC_TAX_SETTINGS_SELECT)
    .single()

  if (error) throw toInvoicingError(error)
  if (!data) throw new Error('No se recibió la configuración guardada. Recargá la página.')

  return data as ClinicTaxSettings
}


// -----------------------------------------------------------------------------
// Emisores
// -----------------------------------------------------------------------------

export async function fetchTaxIssuers(): Promise<TaxIssuer[]> {
  const { data, error } = await supabase
    .from('tax_issuers')
    .select(TAX_ISSUER_SELECT)
    .order('display_name', { ascending: true })
    .limit(ISSUERS_LIMIT)

  if (error) throw toInvoicingError(error)

  return asArray<TaxIssuer>(data)
}

export type TaxIssuerInput = {
  kind: TaxIssuerKind
  display_name: string
  legal_name: string
  ruc: string
  address: string | null
  phone: string | null
  email: string | null
  linked_user_id: string | null
  is_active: boolean
  notes: string | null
}

function normalizeIssuerInput(input: TaxIssuerInput): TaxIssuerInput {
  const displayName = input.display_name.trim()
  const legalName = input.legal_name.trim() || displayName
  const ruc = autoFormatRuc(input.ruc)

  if (!displayName) throw new Error('Ingresá el nombre con el que factura el emisor.')
  if (!isValidRuc(ruc)) {
    throw new Error(`El RUC debe tener base de 5 a 8 dígitos y verificador. ${RUC_FORMAT_HINT}.`)
  }

  return {
    kind: input.kind,
    display_name: displayName,
    legal_name: legalName,
    ruc,
    address: input.address?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
    linked_user_id: input.linked_user_id || null,
    is_active: input.is_active,
    notes: input.notes?.trim() || null,
  }
}

export async function createTaxIssuer(input: TaxIssuerInput): Promise<TaxIssuer> {
  const { data, error } = await supabase
    .from('tax_issuers')
    .insert(normalizeIssuerInput(input))
    .select(TAX_ISSUER_SELECT)
    .single()

  if (error) throw toInvoicingError(error)
  if (!data) throw new Error('No se recibió el emisor guardado. Recargá la lista.')

  return data as TaxIssuer
}

export async function updateTaxIssuer(
  issuerId: string,
  input: TaxIssuerInput,
): Promise<TaxIssuer> {
  const { data, error } = await supabase
    .from('tax_issuers')
    .update(normalizeIssuerInput(input))
    .eq('id', issuerId)
    .select(TAX_ISSUER_SELECT)
    .single()

  if (error) throw toInvoicingError(error)
  if (!data) throw new Error('No se recibió el emisor actualizado. Recargá la lista.')

  return data as TaxIssuer
}

/** Los emisores no se borran (sus facturas los referencian): se activan o pausan. */
export async function setTaxIssuerActive(
  issuerId: string,
  isActive: boolean,
): Promise<TaxIssuer> {
  const { data, error } = await supabase
    .from('tax_issuers')
    .update({ is_active: isActive })
    .eq('id', issuerId)
    .select(TAX_ISSUER_SELECT)
    .single()

  if (error) throw toInvoicingError(error)
  if (!data) throw new Error('No se pudo actualizar el emisor. Recargá la lista.')

  return data as TaxIssuer
}


// -----------------------------------------------------------------------------
// Timbrados
// -----------------------------------------------------------------------------

export async function fetchTimbrados(): Promise<InvoicingTimbrado[]> {
  const { data, error } = await supabase
    .from('invoicing_timbrados')
    .select(TIMBRADO_SELECT)
    .order('valid_from', { ascending: false })
    .limit(TIMBRADOS_LIMIT)

  if (error) throw toInvoicingError(error)

  return asArray<InvoicingTimbrado>(data)
}

export type TimbradoInput = {
  issuer_id: string
  timbrado_number: string
  establishment: string
  emission_point: string
  mode: TimbradoMode
  range_from: number
  range_to: number
  last_number: number
  valid_from: string
  valid_until: string | null
  is_active: boolean
  notes: string | null
}

function normalizeTimbradoInput(input: TimbradoInput): TimbradoInput {
  const timbradoNumber = input.timbrado_number.trim()
  const establishment = input.establishment.trim()
  const emissionPoint = input.emission_point.trim()
  const rangeFrom = Math.trunc(input.range_from)
  const rangeTo = Math.trunc(input.range_to)
  const lastNumber = Math.trunc(input.last_number)

  if (!input.issuer_id) throw new Error('Elegí el emisor del timbrado.')
  if (!/^\d{8}$/.test(timbradoNumber)) {
    throw new Error('El número de timbrado debe tener 8 dígitos.')
  }
  if (!/^\d{3}$/.test(establishment) || !/^\d{3}$/.test(emissionPoint)) {
    throw new Error('El establecimiento y el punto de expedición deben tener 3 dígitos.')
  }
  if (
    !Number.isFinite(rangeFrom) ||
    !Number.isFinite(rangeTo) ||
    rangeFrom < 1 ||
    rangeTo < rangeFrom
  ) {
    throw new Error('El rango del timbrado no es válido: el «hasta» debe ser mayor o igual al «desde».')
  }
  if (!Number.isFinite(lastNumber) || lastNumber < 0 || lastNumber > rangeTo) {
    throw new Error('El último correlativo usado debe estar entre 0 y el tope del rango.')
  }
  if (input.valid_until && input.valid_until < input.valid_from) {
    throw new Error('La vigencia del timbrado termina antes de empezar.')
  }

  return {
    issuer_id: input.issuer_id,
    timbrado_number: timbradoNumber,
    establishment,
    emission_point: emissionPoint,
    mode: input.mode,
    range_from: rangeFrom,
    range_to: rangeTo,
    last_number: lastNumber,
    valid_from: input.valid_from,
    valid_until: input.valid_until || null,
    is_active: input.is_active,
    notes: input.notes?.trim() || null,
  }
}

export async function createTimbrado(input: TimbradoInput): Promise<InvoicingTimbrado> {
  const { data, error } = await supabase
    .from('invoicing_timbrados')
    .insert(normalizeTimbradoInput(input))
    .select(TIMBRADO_SELECT)
    .single()

  if (error) throw toInvoicingError(error)
  if (!data) throw new Error('No se recibió el timbrado guardado. Recargá la lista.')

  return asRow<InvoicingTimbrado>(data)
}

export async function updateTimbrado(
  timbradoId: string,
  input: TimbradoInput,
): Promise<InvoicingTimbrado> {
  const { data, error } = await supabase
    .from('invoicing_timbrados')
    .update(normalizeTimbradoInput(input))
    .eq('id', timbradoId)
    .select(TIMBRADO_SELECT)
    .single()

  if (error) throw toInvoicingError(error)
  if (!data) throw new Error('No se recibió el timbrado actualizado. Recargá la lista.')

  return asRow<InvoicingTimbrado>(data)
}

export async function setTimbradoActive(
  timbradoId: string,
  isActive: boolean,
): Promise<InvoicingTimbrado> {
  const { data, error } = await supabase
    .from('invoicing_timbrados')
    .update({ is_active: isActive })
    .eq('id', timbradoId)
    .select(TIMBRADO_SELECT)
    .single()

  if (error) throw toInvoicingError(error)
  if (!data) throw new Error('No se pudo actualizar el timbrado. Recargá la lista.')

  return asRow<InvoicingTimbrado>(data)
}

/**
 * Correlativo que propone la base (misma lógica que la emisión).
 * Devuelve `null` cuando el rango está agotado.
 */
export async function fetchNextTimbradoSequence(
  timbradoId: string,
): Promise<number | null> {
  const { data, error } = await supabase.rpc('next_timbrado_sequence', {
    p_timbrado_id: timbradoId,
  })

  if (error) throw toInvoicingError(error)

  return typeof data === 'number' ? data : null
}


// -----------------------------------------------------------------------------
// Facturas emitidas
// -----------------------------------------------------------------------------

export async function fetchInvoices(limit = INVOICES_LIMIT): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_SELECT)
    .order('issued_at', { ascending: false })
    .limit(limit)

  if (error) throw toInvoicingError(error)

  return asArray<Invoice>(data).map(normalizeInvoice)
}

export type IssueInvoiceInput = {
  timbradoId: string
  /**
   * Correlativo escrito a mano. `null` deja que la base resuelva el que sigue
   * (autoimpresor, electrónica y preimpreso tienen su propia dirección).
   */
  sequenceNumber: number | null
  customer: {
    name: string
    ruc: string | null
    document: string | null
    email: string | null
    address: string | null
  }
  patientId: string | null
  transactionId: string | null
  /** Importe total con IVA incluido. */
  amount: number
  vatRate: VatRate
  paymentMethod: PaymentMethod | null
  /** CDC de 44 dígitos (solo factura electrónica). */
  cdc: string | null
  notes: string | null
  issuedAt?: string | null
  /** Contado (se cobra al emitir) o crédito (en cuotas o a plazo). */
  condition?: InvoiceCondition
  /** Plan de cuotas; la suma tiene que dar el total de la factura. */
  installments?: InstallmentDraft[]
  /** Cobros ya cobrados en caja que pagan esta factura (anticipos, abonos). */
  paymentAllocations?: InvoicePaymentAllocationInput[]
  /** Cobro nuevo: se registra en caja junto con la emisión. */
  cashPayment?: InvoiceCashPaymentInput | null
}

/** Valida el plan de cuotas y los cobros antes de llegar a la base. */
function assertPaymentPlan(input: IssueInvoiceInput, amount: number): void {
  const installments = input.installments ?? []
  const allocations = (input.paymentAllocations ?? []).filter((item) => item.amount > 0)

  if (installments.length > 1 && input.condition === 'contado') {
    throw new Error('Una factura al contado no puede tener cuotas. Cambiá la condición a crédito.')
  }

  if (installments.length > 0) {
    if (installments.some((item) => !item.due_date || Math.round(item.amount) <= 0)) {
      throw new Error('Cada cuota necesita fecha de vencimiento e importe mayor a cero.')
    }

    const planTotal = installments.reduce((sum, item) => sum + Math.round(item.amount), 0)

    if (Math.abs(planTotal - amount) > 1) {
      throw new Error(
        `Las cuotas suman ${planTotal} y la factura es de ${amount}. Ajustá el plan antes de emitir.`,
      )
    }
  }

  const allocatedTotal = allocations.reduce((sum, item) => sum + Math.round(item.amount), 0)

  if (allocatedTotal > amount) {
    throw new Error('Los cobros aplicados superan el total de la factura.')
  }

  if (!input.cashPayment) return

  if (allocations.length > 0) {
    throw new Error('Elegí entre aplicar cobros existentes o registrar un cobro nuevo.')
  }

  const cashAmount = Math.round(input.cashPayment.amount)

  if (!Number.isFinite(cashAmount) || cashAmount <= 0) {
    throw new Error('El importe del cobro en caja debe ser mayor a cero.')
  }

  if (cashAmount > amount) {
    throw new Error('El cobro en caja no puede superar el total de la factura.')
  }

  if (!input.patientId) {
    throw new Error('Asociá un paciente para registrar el cobro en caja.')
  }

  if (!input.cashPayment.method) {
    throw new Error('Elegí la forma de cobro (efectivo, tarjeta, transferencia…).')
  }
}

/**
 * Emite una factura con `public.issue_invoice` (transacción atómica).
 *
 * La base decide el correlativo cuando `sequenceNumber` es `null`, valida el
 * rango y los duplicados, guarda el comprobante, crea el plan de cuotas y
 * aplica los cobros de caja. Todo o nada: si un cobro falla, no queda factura.
 */
export async function issueInvoice(input: IssueInvoiceInput): Promise<Invoice> {
  const amount = Math.round(input.amount)
  const customerName = input.customer.name.trim()

  if (!input.timbradoId) {
    throw new Error('Elegí el timbrado con el que se emite la factura.')
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('El importe de la factura debe ser mayor a cero.')
  }
  if (!customerName) {
    throw new Error('Ingresá el nombre o la razón social del cliente.')
  }

  assertPaymentPlan(input, amount)

  const breakdown = computeInvoiceBreakdown(amount, input.vatRate)
  const installments = input.installments ?? []
  const allocations = (input.paymentAllocations ?? []).filter((item) => item.amount > 0)
  const cashPayment = input.cashPayment ?? null


  const { data, error } = await supabase.rpc('issue_invoice', {
    p_timbrado_id: input.timbradoId,
    p_invoice: {
      sequence_number: input.sequenceNumber,
      customer_name: customerName,
      customer_ruc: input.customer.ruc?.trim() || null,
      customer_document: input.customer.document?.trim() || null,
      customer_email: input.customer.email?.trim() || null,
      customer_address: input.customer.address?.trim() || null,
      vat_rate: input.vatRate,
      amount_10: breakdown.amount10,
      amount_5: breakdown.amount5,
      amount_exempt: breakdown.exempt,
      iva_10: breakdown.iva10,
      iva_5: breakdown.iva5,
      payment_method: input.paymentMethod,
      patient_id: input.patientId,
      transaction_id: input.transactionId,
      cdc: input.cdc,
      notes: input.notes?.trim() || null,
      issued_at: input.issuedAt ?? null,
      currency: 'PYG',
      condition: input.condition ?? 'contado',
      installments:
        installments.length > 0
          ? installments.map((item) => ({
              number: item.number,
              due_date: item.due_date,
              amount: Math.round(item.amount),
            }))
          : null,
      payment_allocations:
        allocations.length > 0
          ? allocations.map((item) => ({
              transaction_id: item.transactionId,
              amount: Math.round(item.amount),
              installment_id: item.installmentId ?? null,
            }))
          : null,
      cash_payment: cashPayment
        ? {
            amount: Math.round(cashPayment.amount),
            method: cashPayment.method,
            receipt_number: cashPayment.receiptNumber?.trim() || null,
            paid_at: cashPayment.paidAt ?? null,
            reference: cashPayment.reference?.trim() || null,
            notes: cashPayment.notes?.trim() || null,
            installment_id: cashPayment.installmentId ?? null,
          }
        : null,
    },
  })

  if (error) throw toInvoicingError(error)

  const row = Array.isArray(data) ? data[0] : data

  if (!row) {
    throw new Error('La factura se emitió pero no se recibió el comprobante. Recargá la lista.')
  }

  return normalizeInvoice(row as Invoice)
}

/** Anula una factura emitida. El número queda consumido (no se reutiliza). */
export async function cancelInvoice(
  invoiceId: string,
  reason: string,
): Promise<Invoice> {
  const trimmed = reason.trim()

  if (!trimmed) throw new Error('Indicá el motivo de la anulación.')

  const { data, error } = await supabase
    .from('invoices')
    .update({
      status: 'cancelled' as const,
      cancelled_at: new Date().toISOString(),
      cancellation_reason: trimmed,
    })
    .eq('id', invoiceId)
    .eq('status', 'issued')
    .select(INVOICE_SELECT)
    .maybeSingle()

  if (error) throw toInvoicingError(error)

  if (!data) {
    throw new Error('La factura ya estaba anulada o no existe. Actualizá la lista.')
  }

  return normalizeInvoice(asRow<Invoice>(data))
}


// -----------------------------------------------------------------------------
// Cobros, abonos y cuotas
// -----------------------------------------------------------------------------

export type RegisterInvoicePaymentInput = {
  invoiceId: string
  /** Importe cobrado; puede ser un abono parcial. */
  amount: number
  method: PaymentMethod | null
  /** Cuota que se imputa; `null` deja que la base elija la primera impaga. */
  installmentId?: string | null
  receiptNumber?: string | null
  /** Fecha del cobro; si falta, la base usa `now()`. */
  paidAt?: string | null
  reference?: string | null
  notes?: string | null
}

/**
 * Registra un cobro o abono de una factura con `register_invoice_payment`.
 *
 * La base crea el movimiento en caja, lo aplica a la factura (y a la cuota) y
 * recalcula `paid_amount` / `payment_status` en la misma transacción. Si algo
 * falla no queda ni movimiento ni factura cobrada.
 */
export async function registerInvoicePayment(
  input: RegisterInvoicePaymentInput,
): Promise<Invoice> {
  const amount = Math.round(input.amount)

  if (!input.invoiceId) throw new Error('Elegí la factura que se va a cobrar.')
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('El importe del cobro debe ser mayor a cero.')
  }

  const { data, error } = await supabase.rpc('register_invoice_payment', {
    p_payment: {
      invoice_id: input.invoiceId,
      amount,
      method: input.method,
      receipt_number: input.receiptNumber?.trim() || null,
      paid_at: input.paidAt ?? null,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      installment_id: input.installmentId ?? null,
    },
  })

  if (error) throw toInvoicingError(error)

  const payload = data as { invoice?: Invoice } | null
  const row = payload?.invoice

  if (!row) {
    throw new Error('El cobro se registró pero no se recibió la factura. Recargá la lista.')
  }

  return normalizeInvoice(row)
}

/** Cuotas de una factura, ordenadas por número. */
export async function fetchInvoiceInstallments(
  invoiceId: string,
): Promise<InvoiceInstallment[]> {
  const { data, error } = await supabase
    .from('invoice_installments')
    .select(INSTALLMENT_SELECT)
    .eq('invoice_id', invoiceId)
    .order('number', { ascending: true })

  if (error) throw toInvoicingError(error)

  return asArray<InvoiceInstallment>(data).map(normalizeInstallment)
}

/** Cobros aplicados a una factura (`invoice_payment_allocations`). */
export async function fetchInvoiceAllocations(
  invoiceId: string,
): Promise<InvoicePaymentAllocation[]> {
  const { data, error } = await supabase
    .from('invoice_payment_allocations')
    .select(PAYMENT_ALLOCATION_SELECT)
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true })

  if (error) throw toInvoicingError(error)

  return asArray<InvoicePaymentAllocation>(data)
}

/**
 * Estado de facturación de un cobro (`public.transaction_invoicing`).
 *
 * `available_amount` es lo que queda del cobro para imputar a una factura: la
 * caja lo usa para no facturar dos veces el mismo dinero.
 */
export type TransactionInvoicing = {
  transaction_id: string
  patient_id: string
  type: TransactionType
  status: TransactionStatus
  amount: number
  invoiced_amount: number
  available_amount: number
  invoice_count: number
  invoice_numbers: string[]
}

const TRANSACTION_INVOICING_SELECT = [
  'transaction_id',
  'patient_id',
  'type',
  'status',
  'amount',
  'invoiced_amount',
  'available_amount',
  'invoice_count',
  'invoice_numbers',
].join(', ')

/** Estado de facturación de los cobros indicados (vacío si no hay ninguno). */
export async function fetchTransactionInvoicing(
  transactionIds: string[],
): Promise<TransactionInvoicing[]> {
  const ids = [...new Set(transactionIds)].filter(Boolean).slice(0, INVOICES_LIMIT)

  if (ids.length === 0) return []

  const { data, error } = await supabase
    .from('transaction_invoicing')
    .select(TRANSACTION_INVOICING_SELECT)
    .in('transaction_id', ids)

  if (error) throw toInvoicingError(error)

  return asArray<TransactionInvoicing>(data).map((row) => ({
    ...row,
    amount: toNumber(row.amount),
    invoiced_amount: toNumber(row.invoiced_amount),
    available_amount: toNumber(row.available_amount),
    invoice_count: toNumber(row.invoice_count),
    invoice_numbers: row.invoice_numbers ?? [],
  }))
}

/** Reemplaza el plan de cuotas de una factura ya emitida (`plan_invoice_installments`). */
export async function planInvoiceInstallments(
  invoiceId: string,
  plan: InstallmentDraft[],
): Promise<InvoiceInstallment[]> {
  if (!invoiceId) throw new Error('Elegí la factura a la que se le asigna el plan.')
  if (plan.length === 0) throw new Error('El plan necesita al menos una cuota.')

  const { data, error } = await supabase.rpc('plan_invoice_installments', {
    p_invoice_id: invoiceId,
    p_installments: plan.map((item) => ({
      number: item.number,
      due_date: item.due_date,
      amount: Math.round(item.amount),
    })),
  })

  if (error) throw toInvoicingError(error)

  return asArray<InvoiceInstallment>(data)
    .map(normalizeInstallment)
    .sort((left, right) => left.number - right.number)
}


// -----------------------------------------------------------------------------
// Facturas de gastos (egresos)
// -----------------------------------------------------------------------------

export async function fetchExpenseInvoices(
  limit = EXPENSES_LIMIT,
): Promise<ExpenseInvoice[]> {
  const { data, error } = await supabase
    .from('expense_invoices')
    .select(EXPENSE_INVOICE_SELECT)
    .order('issued_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw toInvoicingError(error)

  return asArray<ExpenseInvoice>(data).map(normalizeExpense)
}

export type ExpenseInvoiceInput = {
  supplier_name: string
  supplier_ruc: string | null
  timbrado_number: string | null
  invoice_number: string
  expense_kind: string | null
  issued_on: string
  description: string | null
  /** Desglose con IVA incluido por franja (el IVA se calcula acá). */
  amount10: number
  amount5: number
  exempt: number
  payment_method: PaymentMethod | null
  /** `null` = gasto general de la clínica. */
  attributed_issuer_id: string | null
  notes: string | null
}

/**
 * Alta o edición de una factura de gasto.
 * El total y el IVA despejado se calculan siempre en el cliente con los
 * divisores de la SET (no se confía en lo que venga del formulario).
 */
export async function saveExpenseInvoice(
  input: ExpenseInvoiceInput,
  expenseId: string | null = null,
): Promise<ExpenseInvoice> {
  const supplierName = input.supplier_name.trim()
  const invoiceNumber = input.invoice_number.trim()
  const breakdown = computeVatBreakdown({
    amount10: input.amount10,
    amount5: input.amount5,
    exempt: input.exempt,
  })

  if (!supplierName) throw new Error('Ingresá el nombre o la razón social del proveedor.')
  if (!invoiceNumber) throw new Error('Ingresá el número de la factura del proveedor.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issued_on)) {
    throw new Error('Indicá la fecha de emisión de la factura.')
  }
  if (breakdown.total <= 0) throw new Error('El total del gasto debe ser mayor a cero.')

  const payload = {
    supplier_name: supplierName,
    supplier_ruc: input.supplier_ruc?.trim() || null,
    timbrado_number: input.timbrado_number?.trim() || null,
    invoice_number: invoiceNumber,
    expense_kind: input.expense_kind?.trim() || null,
    issued_on: input.issued_on,
    description: input.description?.trim() || null,
    amount_10: breakdown.amount10,
    amount_5: breakdown.amount5,
    amount_exempt: breakdown.exempt,
    iva_10: breakdown.iva10,
    iva_5: breakdown.iva5,
    total: breakdown.total,
    currency: 'PYG',
    payment_method: input.payment_method,
    attributed_issuer_id: input.attributed_issuer_id || null,
    notes: input.notes?.trim() || null,
  }

  if (expenseId) {
    const { data, error } = await supabase
      .from('expense_invoices')
      .update(payload)
      .eq('id', expenseId)
      .select(EXPENSE_INVOICE_SELECT)
      .single()

    if (error) throw toInvoicingError(error)
    if (!data) throw new Error('No se recibió el gasto actualizado. Recargá la lista.')

    return normalizeExpense(asRow<ExpenseInvoice>(data))
  }

  const { data, error } = await supabase
    .from('expense_invoices')
    .insert(payload)
    .select(EXPENSE_INVOICE_SELECT)
    .single()

  if (error) throw toInvoicingError(error)
  if (!data) throw new Error('No se recibió el gasto guardado. Recargá la lista.')

  return normalizeExpense(asRow<ExpenseInvoice>(data))
}

export async function deleteExpenseInvoice(expenseId: string): Promise<void> {
  const { error } = await supabase
    .from('expense_invoices')
    .delete()
    .eq('id', expenseId)

  if (error) throw toInvoicingError(error)
}
