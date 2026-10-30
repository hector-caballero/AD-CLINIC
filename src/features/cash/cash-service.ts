import { supabase } from '../../lib/supabase'
import type { CashRange } from './cash-dates'
import { startOfLocalMonth } from './cash-dates'
import { toCashError } from './cash-errors'
import { computeChargeTotal } from './cash-metrics'
import {
  BALANCE_SELECT,
  CASH_CURRENCY,
  CASH_MOVEMENT_SELECT,
  TREATMENT_SELECT,
  type CashMovement,
  type CashOverview,
  type CashPatient,
  type ChargeItemInput,
  type MovementResult,
  type MovementTreatment,
  type PatientBalance,
  type PaymentInput,
  type PaymentRecord,
  type TreatmentCatalogItem,
  type TreatmentChargeInput,
  type TreatmentStatus,
} from './cash-types'

/**
 * Acceso a las tablas de caja.
 *
 * - `transactions`: cuenta corriente (cargos, pagos, devoluciones, ajustes).
 * - `patient_treatments`: tratamientos realizados, con el precio congelado.
 * - `treatments`: catálogo de precios.
 * - `patient_balances`: vista con el saldo calculado por paciente.
 *
 * Un cobro de tratamiento crea el/los `patient_treatments` y sus `charge`; si se
 * cobra en el momento, agrega además un `payment` por el total. Ese par
 * cargo+pago es lo que deja el saldo del paciente en cero y registra el ingreso
 * en caja (la vista solo resta los pagos con estado `paid`).
 */

/** Tope de filas del historial visible. */
export const CASH_MOVEMENTS_LIMIT = 500

/** Tope de movimientos del estado de cuenta de un paciente. */
export const PATIENT_ACCOUNT_MOVEMENTS_LIMIT = 200

/** Tope de filas de la vista de saldos (coincide con `db-max-rows`). */
export const BALANCES_LIMIT = 1000

/** Tope de pagos del mes usados para las métricas. */
export const MONTH_PAYMENTS_LIMIT = 1000

/** Tope del catálogo de tratamientos. */
export const TREATMENTS_LIMIT = 500

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(parsed) ? parsed : 0
}

/** PostgREST devuelve la relación como objeto; se tolera también el arreglo. */
function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null

  return Array.isArray(value) ? (value[0] ?? null) : value
}

function normalizeMovement(row: CashMovement): CashMovement {
  const patient = firstOf(row.patient as CashPatient | CashPatient[] | null)
  const item = firstOf(row.patient_treatment as MovementTreatment | MovementTreatment[] | null)
  const treatment = item ? firstOf(item.treatment) : null

  return {
    ...row,
    amount: toNumber(row.amount),
    patient,
    patient_treatment: item
      ? {
          ...item,
          quantity: Math.max(1, toNumber(item.quantity)),
          unit_price: toNumber(item.unit_price),
          total_price: toNumber(item.total_price),
          treatment,
        }
      : null,
  }
}

function normalizeBalance(row: PatientBalance): PatientBalance {
  return {
    ...row,
    total_charges: toNumber(row.total_charges),
    total_adjustments: toNumber(row.total_adjustments),
    total_payments: toNumber(row.total_payments),
    total_refunds: toNumber(row.total_refunds),
    balance: toNumber(row.balance),
  }
}

export async function fetchMovements(
  range: CashRange,
  patientId?: string,
): Promise<CashMovement[]> {
  let query = supabase
    .from('transactions')
    .select(CASH_MOVEMENT_SELECT)
    .order('created_at', { ascending: false })
    .limit(patientId ? PATIENT_ACCOUNT_MOVEMENTS_LIMIT : CASH_MOVEMENTS_LIMIT)

  if (range.fromIso) query = query.gte('created_at', range.fromIso)
  if (range.toIso) query = query.lt('created_at', range.toIso)
  if (patientId) query = query.eq('patient_id', patientId)

  const { data, error } = await query

  if (error) throw toCashError(error)

  return ((data ?? []) as unknown as CashMovement[]).map(normalizeMovement)
}

/**
 * Datos de las tarjetas: pagos confirmados del mes, saldos de la vista y
 * cantidad de tratamientos realizados (total y del mes).
 */
export async function fetchCashOverview(now: Date = new Date()): Promise<CashOverview> {
  const monthStartIso = startOfLocalMonth(now).toISOString()

  const [paymentsResult, balancesResult, treatmentsTotalResult, treatmentsMonthResult] =
    await Promise.all([
      supabase
        .from('transactions')
        .select('amount, paid_at')
        .eq('type', 'payment')
        .eq('status', 'paid')
        .gte('paid_at', monthStartIso)
        .order('paid_at', { ascending: false })
        .limit(MONTH_PAYMENTS_LIMIT),
      supabase.from('patient_balances').select(BALANCE_SELECT).limit(BALANCES_LIMIT),
      supabase
        .from('patient_treatments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed'),
      supabase
        .from('patient_treatments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed')
        .gte('performed_at', monthStartIso),
    ])

  const error =
    paymentsResult.error ??
    balancesResult.error ??
    treatmentsTotalResult.error ??
    treatmentsMonthResult.error

  if (error) throw toCashError(error)

  const payments = ((paymentsResult.data ?? []) as { amount: unknown; paid_at: string | null }[]).map(
    (row): PaymentRecord => ({ amount: toNumber(row.amount), paid_at: row.paid_at }),
  )

  return {
    payments,
    balances: ((balancesResult.data ?? []) as unknown as PatientBalance[]).map(normalizeBalance),
    treatments: {
      total: treatmentsTotalResult.count ?? 0,
      month: treatmentsMonthResult.count ?? 0,
    },
  }
}

/** Estado de cuenta de un paciente: saldo de la vista + sus movimientos. */
export async function fetchPatientAccount(patientId: string): Promise<{
  balance: PatientBalance | null
  movements: CashMovement[]
}> {
  const [balanceResult, movements] = await Promise.all([
    supabase.from('patient_balances').select(BALANCE_SELECT).eq('patient_id', patientId).maybeSingle(),
    fetchMovements({ fromIso: null, toIso: null, label: 'Estado de cuenta' }, patientId),
  ])

  if (balanceResult.error) throw toCashError(balanceResult.error)

  return {
    balance: balanceResult.data
      ? normalizeBalance(balanceResult.data as unknown as PatientBalance)
      : null,
    movements,
  }
}

/** Catálogo activo, ordenado por categoría y nombre. */
export async function fetchTreatmentsCatalog(): Promise<TreatmentCatalogItem[]> {
  const { data, error } = await supabase
    .from('treatments')
    .select(TREATMENT_SELECT)
    .eq('is_active', true)
    .order('category', { ascending: true })
    .order('name', { ascending: true })
    .limit(TREATMENTS_LIMIT)

  if (error) throw toCashError(error)

  return ((data ?? []) as unknown as TreatmentCatalogItem[]).map((item) => ({
    ...item,
    default_price: toNumber(item.default_price),
    default_duration_minutes: toNumber(item.default_duration_minutes),
  }))
}

/** Borrado de compensación: si un paso falla, no se dejan filas huérfanas. */
/** Borrado de compensación: si un paso falla, no se dejan filas huérfanas. */
async function deleteByIds(
  table: 'transactions' | 'patient_treatments',
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return

  try {
    await supabase.from(table).delete().in('id', ids)
  } catch {
    // Best-effort: el error original es el que se informa al usuario.
  }
}

/**
 * Registra un cobro de tratamiento.
 *
 * 1. Un `patient_treatments` por ítem (estado `completed`, precio congelado).
 * 2. Un `charge` por ítem, vinculado al tratamiento realizado.
 * 3. Si se cobra ahora, un `payment` por el total con el método y el recibo.
 *
 * El guaraní no admite centavos: los importes se redondean. Este flujo cobra el
 * total o deja el cargo pendiente; los pagos parciales se registran con un
 * abono libre.
 */
export async function registerTreatmentCharge(
  input: TreatmentChargeInput,
): Promise<MovementResult> {
  if (!input.patientId) throw new Error('Elegí el paciente del cobro.')
  if (input.items.length === 0) throw new Error('Elegí al menos un tratamiento del catálogo.')
  if (input.collected && !input.method) throw new Error('Elegí el método de pago del cobro.')

  const billableItems = input.items.filter(
    (item) => Math.round(item.quantity) > 0 && item.unitPrice > 0,
  )

  if (billableItems.length === 0) {
    throw new Error(
      'Los tratamientos elegidos no tienen precio cargado. Actualizá el catálogo antes de cobrar.',
    )
  }

  const total = computeChargeTotal(billableItems)

  if (total <= 0) {
    throw new Error(
      'El total del cobro es cero. Revisá el precio del tratamiento en el catálogo antes de cobrar.',
    )
  }

  const nowIso = new Date().toISOString()
  const treatmentIds: string[] = []
  const chargeIds: string[] = []
  const created: { patientTreatmentId: string; item: ChargeItemInput }[] = []

  try {
    for (const item of billableItems) {
      const quantity = Math.max(1, Math.round(item.quantity))

      const { data, error } = await supabase
        .from('patient_treatments')
        .insert({
          patient_id: input.patientId,
          treatment_id: item.treatmentId,
          status: 'completed' satisfies TreatmentStatus,
          quantity,
          unit_price: Math.max(0, item.unitPrice),
          performed_at: nowIso,
          clinical_notes: input.notes,
        })
        .select('id')
        .single()

      if (error) throw toCashError(error)
      if (!data) {
        throw new Error('Supabase no devolvió el tratamiento registrado. Recargá el historial.')
      }

      const createdRow = data as { id: string }

      treatmentIds.push(createdRow.id)
      created.push({ patientTreatmentId: createdRow.id, item: { ...item, quantity } })
    }

    const charges = created.map(({ patientTreatmentId, item }) => ({
      patient_id: input.patientId,
      patient_treatment_id: patientTreatmentId,
      type: 'charge' as const,
      status: input.collected ? ('paid' as const) : ('pending' as const),
      amount: Math.round(Math.max(1, item.quantity) * Math.max(0, item.unitPrice)),
      currency: CASH_CURRENCY,
      notes: input.notes,
    }))

    const { data: chargeData, error: chargeError } = await supabase
      .from('transactions')
      .insert(charges)
      .select('id')

    if (chargeError) throw toCashError(chargeError)

    for (const row of (chargeData ?? []) as { id: string }[]) chargeIds.push(row.id)

    if (input.collected) {
      const { error: paymentError } = await supabase.from('transactions').insert({
        patient_id: input.patientId,
        type: 'payment' as const,
        status: 'paid' as const,
        method: input.method,
        amount: total,
        currency: CASH_CURRENCY,
        paid_at: nowIso,
        receipt_number: input.receiptNumber,
        reference:
          created.length === 1 ? 'Cobro de tratamiento' : `Cobro de ${created.length} tratamientos`,
        notes: input.notes,
      })

      if (paymentError) throw toCashError(paymentError)
    }

    return { patientId: input.patientId, kind: 'charge', total, collected: input.collected }
  } catch (error) {
    await Promise.all([
      deleteByIds('transactions', chargeIds),
      deleteByIds('patient_treatments', treatmentIds),
    ])

    throw error instanceof Error ? error : toCashError(error)
  }
}

/** Abono libre del paciente: un pago confirmado que reduce su saldo. */
export async function registerPayment(input: PaymentInput): Promise<MovementResult> {
  if (!input.patientId) throw new Error('Elegí el paciente del abono.')

  const amount = Math.round(input.amount)

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Ingresá un monto mayor a cero para registrar el abono.')
  }

  const { error } = await supabase.from('transactions').insert({
    patient_id: input.patientId,
    type: 'payment' as const,
    status: 'paid' as const,
    method: input.method,
    amount,
    currency: CASH_CURRENCY,
    paid_at: new Date().toISOString(),
    receipt_number: input.receiptNumber,
    reference: input.reference?.trim() || 'Abono a cuenta',
    notes: input.notes,
  })

  if (error) throw toCashError(error)

  return { patientId: input.patientId, kind: 'payment', total: amount, collected: true }
}


