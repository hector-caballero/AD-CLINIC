import type { PatientTransactionLink } from '../cash/cash-service'
import type { TransactionInvoicing } from '../invoicing/invoicing-service'
import type {
  Invoice,
  InvoicePaymentAllocationInput,
  InvoicePaymentStatus,
} from '../invoicing/invoicing-types'
import { computeOdontogramTotals, type OdontogramItem } from './odontogram-types'

/**
 * Estado financiero del plan de tratamiento.
 *
 * Cruza el odontograma con la facturación y la caja:
 * - **Cobrado**: pagos confirmados del paciente (`transactions` tipo `payment`
 *   con estado `paid`). La caja no separa un pago por procedimiento, así que el
 *   cobro se descuenta del total del plan visible. Los cobros imputados a
 *   facturas ya están en esa lista, por eso no se suma aparte el `paid_amount`:
 *   `invoice_payment_allocations` enlaza factura → pago, no crea dinero nuevo.
 * - **Facturado**: facturas emitidas del paciente (`invoices` con estado
 *   `issued`). Lo que no está respaldado por un comprobante queda como
 *   «pendiente de facturar».
 * - **Línea cobrada**: el `charge` enlazado al `patient_treatment_id` de la
 *   línea está pagado (cobro en el momento) o pendiente (cargo a cuenta).
 */

/** Importe saneado en guaraníes (nunca negativo, sin centavos). */
function toAmount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0
}

/** Factura emitida resumida para el panel del plan. */
export type PlanInvoiceSummary = {
  id: string
  invoiceNumber: string
  total: number
  paidAmount: number
  balance: number
  paymentStatus: InvoicePaymentStatus
  issuedAt: string
}

/** Cobro confirmado que todavía conserva importe sin facturar. */
export type PlanAvailablePayment = {
  id: string
  amount: number
  /** Resto del cobro que puede imputarse a una factura nueva. */
  availableAmount: number
  paidAt: string | null
}

/** Estado administrativo de una línea del plan. */
export type PlanItemFinancialState = {
  /** El cargo en caja de la línea figura como pagado. */
  isPaid: boolean
  /** Toda la línea está respaldada por facturas emitidas. */
  isInvoiced: boolean
  /** Números de factura que respaldan la línea (vacío si no está facturada). */
  invoiceNumbers: string[]
}

export type PlanFinancialSummary = {
  /** Suma de los procedimientos del plan (sin piezas ausentes). */
  planTotal: number
  /** Pagos confirmados del paciente, imputados o no a una factura. */
  collectedAmount: number
  /** `planTotal - collectedAmount`, nunca negativo. */
  remainingToCollect: number
  /** Total respaldado por facturas emitidas del paciente. */
  invoicedAmount: number
  /** `planTotal - invoicedAmount`, nunca negativo. */
  unbilledAmount: number
  invoiceCount: number
  invoiceNumbers: string[]
  invoices: PlanInvoiceSummary[]
  /** Cobros con saldo sin facturar, del más viejo al más nuevo. */
  availablePayments: PlanAvailablePayment[]
  /** Estado por `odontogram_items.id` (solo líneas con importe). */
  items: Map<string, PlanItemFinancialState>
  /** El plan ya no tiene saldo por cobrar. */
  isFullyCollected: boolean
  /** El plan está respaldado por facturas emitidas. */
  isFullyInvoiced: boolean
}

export type PlanFinancialsInput = {
  items: OdontogramItem[]
  invoices: Invoice[]
  /** Cargos y pagos confirmados del paciente. */
  transactions: PatientTransactionLink[]
  /** `transaction_invoicing` indexado por `transaction_id`. */
  invoicing: Map<string, TransactionInvoicing>
}

/**
 * Resumen del plan activo. Es una función pura: el hook y el panel la usan sin
 * tocar Supabase, y también se puede probar con datos armados a mano.
 */
export function buildPlanFinancials({
  items,
  invoices,
  transactions,
  invoicing,
}: PlanFinancialsInput): PlanFinancialSummary {
  const planTotal = computeOdontogramTotals(items).plan
  const issued = invoices.filter((invoice) => invoice.status === 'issued')
  const invoicedAmount = issued.reduce((sum, invoice) => sum + toAmount(invoice.total), 0)
  const unbilledAmount = Math.max(0, planTotal - invoicedAmount)
  const isFullyInvoiced = issued.length > 0 && unbilledAmount <= 0
  const invoiceNumbers = issued.map((invoice) => invoice.invoice_number)

  const paidTreatments = new Set<string>()
  const availablePayments: PlanAvailablePayment[] = []
  let collectedAmount = 0

  for (const row of transactions) {
    if (row.type === 'charge' && row.status === 'paid' && row.patient_treatment_id) {
      paidTreatments.add(row.patient_treatment_id)
      continue
    }

    if (row.type !== 'payment' || row.status !== 'paid') continue

    collectedAmount += toAmount(row.amount)

    // Sin fila en la vista se asume el cobro completo: la base vuelve a
    // validar el saldo al emitir la factura.
    const invoicingRow = invoicing.get(row.id)
    const availableAmount = invoicingRow
      ? toAmount(invoicingRow.available_amount)
      : toAmount(row.amount)

    if (availableAmount <= 0) continue

    availablePayments.push({
      id: row.id,
      amount: toAmount(row.amount),
      availableAmount,
      paidAt: row.paid_at,
    })
  }

  availablePayments.sort((left, right) =>
    (left.paidAt ?? '').localeCompare(right.paidAt ?? ''),
  )

  const remainingToCollect = Math.max(0, planTotal - collectedAmount)
  const itemStates = new Map<string, PlanItemFinancialState>()

  for (const item of items) {
    if (item.status === 'absent') continue

    itemStates.set(item.id, {
      isPaid: item.patient_treatment_id ? paidTreatments.has(item.patient_treatment_id) : false,
      isInvoiced: isFullyInvoiced,
      invoiceNumbers: isFullyInvoiced ? invoiceNumbers : [],
    })
  }

  return {
    planTotal,
    collectedAmount,
    remainingToCollect,
    invoicedAmount,
    unbilledAmount,
    invoiceCount: issued.length,
    invoiceNumbers,
    invoices: issued.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoice_number,
      total: toAmount(invoice.total),
      paidAmount: toAmount(invoice.paid_amount),
      balance: toAmount(invoice.balance),
      paymentStatus: invoice.payment_status,
      issuedAt: invoice.issued_at,
    })),
    availablePayments,
    items: itemStates,
    isFullyCollected: planTotal > 0 && remainingToCollect <= 0,
    isFullyInvoiced,
  }
}

/** Datos que completa el formulario de factura al emitir desde el plan. */
export type PlanInvoiceDraft = {
  amount: number
  paymentAllocations: InvoicePaymentAllocationInput[]
}

/**
 * Importe y anticipos sugeridos al facturar el plan.
 *
 * Se factura lo que falta facturar y, si el paciente ya pagó en caja, esos
 * cobros se imputan a la factura (sin volver a registrar un ingreso). La suma de
 * los anticipos nunca supera el importe propuesto.
 */
export function buildPlanInvoiceDraft(summary: PlanFinancialSummary): PlanInvoiceDraft {
  const target = summary.unbilledAmount > 0 ? summary.unbilledAmount : summary.remainingToCollect
  const amount = Math.max(0, Math.round(target))
  const paymentAllocations: InvoicePaymentAllocationInput[] = []
  let pending = amount

  for (const payment of summary.availablePayments) {
    if (pending <= 0) break

    const applied = Math.min(payment.availableAmount, pending)

    if (applied <= 0) continue

    paymentAllocations.push({ transactionId: payment.id, amount: applied })
    pending -= applied
  }

  return { amount, paymentAllocations }
}
