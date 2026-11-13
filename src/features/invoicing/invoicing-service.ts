import { supabase } from '../../lib/supabase'
import type { PaymentMethod } from '../cash/cash-types'
import { autoFormatRuc, isValidRuc, RUC_FORMAT_HINT } from './invoicing-format'
import { toInvoicingError } from './invoicing-errors'
import { computeInvoiceBreakdown, computeVatBreakdown } from './invoicing-tax'
import {
  CLINIC_TAX_SETTINGS_SELECT,
  EXPENSE_INVOICE_SELECT,
  INVOICE_SELECT,
  TAX_ISSUER_SELECT,
  TIMBRADO_SELECT,
  type ClinicTaxSettings,
  type ExpenseInvoice,
  type Invoice,
  type InvoiceIssuerRef,
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

function normalizeInvoice(row: Invoice): Invoice {
  return {
    ...row,
    sequence_number: toNumber(row.sequence_number),
    amount_10: toNumber(row.amount_10),
    amount_5: toNumber(row.amount_5),
    amount_exempt: toNumber(row.amount_exempt),
    iva_10: toNumber(row.iva_10),
    iva_5: toNumber(row.iva_5),
    total: toNumber(row.total),
    issuer: firstOf(row.issuer as InvoiceIssuerRef | InvoiceIssuerRef[] | null),
    timbrado: firstOf(row.timbrado as InvoiceTimbradoRef | InvoiceTimbradoRef[] | null),
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
}

/**
 * Emite una factura con `public.issue_invoice` (transacción atómica).
 *
 * La base decide el correlativo cuando `sequenceNumber` es `null`, valida el
 * rango y los duplicados, guarda el comprobante y actualiza `last_number`.
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

  const breakdown = computeInvoiceBreakdown(amount, input.vatRate)

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
