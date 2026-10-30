import { normalizeSearchText } from '../patients/filter-patients'
import { toDateKey } from './cash-dates'
import {
  getMovementConcept,
  getMovementPatientName,
  type CashMovement,
  type CashOverview,
  type ChargeItemInput,
  type MovementTypeFilter,
  type PatientBalance,
  type TreatmentCatalogItem,
} from './cash-types'

/**
 * Cálculos puros de la caja: no tocan Supabase ni React, así que se pueden
 * probar de forma aislada.
 */

export type CashMetrics = {
  collectedToday: number
  paymentsToday: number
  collectedMonth: number
  paymentsMonth: number
  pendingTotal: number
  creditTotal: number
  debtors: number
  clearPatients: number
  treatmentsTotal: number
  treatmentsMonth: number
}

function toFinite(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(parsed) ? parsed : 0
}

/** Totales de saldo: deuda por cobrar, créditos a favor y pacientes al día. */
export function summarizeBalances(balances: PatientBalance[]): {
  pending: number
  credit: number
  debtors: number
  clear: number
} {
  let pending = 0
  let credit = 0
  let debtors = 0
  let clear = 0

  for (const balance of balances) {
    const value = toFinite(balance.balance)

    if (value >= 1) {
      pending += value
      debtors += 1
    } else if (value <= -1) {
      credit += Math.abs(value)
    } else {
      clear += 1
    }
  }

  return { pending, credit, debtors, clear }
}

/**
 * Métricas de las tarjetas. «Cobrado hoy/mes» cuenta solo pagos confirmados
 * (`type = 'payment'`, `status = 'paid'`), comparando por día local.
 */
export function computeCashMetrics(overview: CashOverview, now: Date = new Date()): CashMetrics {
  const currentDay = toDateKey(now)

  let collectedToday = 0
  let paymentsToday = 0
  let collectedMonth = 0

  for (const payment of overview.payments) {
    const amount = toFinite(payment.amount)

    collectedMonth += amount

    if (!payment.paid_at) continue

    const paidAt = new Date(payment.paid_at)

    if (Number.isNaN(paidAt.getTime())) continue
    if (toDateKey(paidAt) !== currentDay) continue

    collectedToday += amount
    paymentsToday += 1
  }

  const balances = summarizeBalances(overview.balances)

  return {
    collectedToday,
    paymentsToday,
    collectedMonth,
    paymentsMonth: overview.payments.length,
    pendingTotal: balances.pending,
    creditTotal: balances.credit,
    debtors: balances.debtors,
    clearPatients: balances.clear,
    treatmentsTotal: Math.max(0, Math.round(toFinite(overview.treatments.total))),
    treatmentsMonth: Math.max(0, Math.round(toFinite(overview.treatments.month))),
  }
}

/** Total de un cobro: cantidad × precio del catálogo, redondeado a guaraníes. */
export function computeChargeTotal(items: ChargeItemInput[]): number {
  return items.reduce((total, item) => {
    const quantity = Math.max(1, Math.round(toFinite(item.quantity)))
    const unitPrice = Math.max(0, toFinite(item.unitPrice))

    return total + Math.round(quantity * unitPrice)
  }, 0)
}

function matchesType(movement: CashMovement, type: MovementTypeFilter): boolean {
  if (type === 'all') return true
  if (type === 'charges') return movement.type === 'charge'
  if (type === 'payments') return movement.type === 'payment'

  return movement.type === 'adjustment' || movement.type === 'refund'
}

function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D+/g, '')
}

/**
 * Búsqueda en memoria del historial: paciente, concepto, recibo, nota,
 * referencia y teléfono/documento del paciente.
 */
export function filterMovements(
  movements: CashMovement[],
  filters: { query: string; type: MovementTypeFilter },
): CashMovement[] {
  const query = normalizeSearchText(filters.query)
  const digits = filters.query.replace(/\D+/g, '')

  return movements.filter((movement) => {
    if (!matchesType(movement, filters.type)) return false
    if (!query) return true

    const haystack = [
      getMovementPatientName(movement),
      getMovementConcept(movement),
      movement.receipt_number ?? '',
      movement.reference ?? '',
      movement.notes ?? '',
    ].map(normalizeSearchText)

    if (haystack.some((value) => value.includes(query))) return true
    if (!digits) return false

    return [
      movement.receipt_number,
      movement.patient?.phone,
      movement.patient?.document_number,
    ].some((value) => digitsOnly(value).includes(digits))
  })
}

/** Conteo por filtro (se muestra como chip al lado de cada opción). */
export function countMovementsByType(
  movements: CashMovement[],
): Record<MovementTypeFilter, number> {
  const counts: Record<MovementTypeFilter, number> = {
    all: movements.length,
    charges: 0,
    payments: 0,
    adjustments: 0,
  }

  for (const movement of movements) {
    if (movement.type === 'charge') counts.charges += 1
    else if (movement.type === 'payment') counts.payments += 1
    else counts.adjustments += 1
  }

  return counts
}

/** Saldos con deuda primero (mayor deuda arriba) y luego por apellido. */
export function sortBalancesByDebt(balances: PatientBalance[]): PatientBalance[] {
  return [...balances].sort((a, b) => {
    const byBalance = toFinite(b.balance) - toFinite(a.balance)

    if (Math.abs(byBalance) >= 1) return byBalance

    const byLastName = a.last_name.localeCompare(b.last_name, 'es', { sensitivity: 'base' })

    if (byLastName !== 0) return byLastName

    return a.first_name.localeCompare(b.first_name, 'es', { sensitivity: 'base' })
  })
}

/** Panel de saldos: busca por nombre o teléfono y puede ocultar los saldos al día. */
export function filterBalances(
  balances: PatientBalance[],
  filters: { query: string; onlyDebtors: boolean },
): PatientBalance[] {
  const query = normalizeSearchText(filters.query)
  const digits = filters.query.replace(/\D+/g, '')

  return sortBalancesByDebt(balances).filter((balance) => {
    if (filters.onlyDebtors && toFinite(balance.balance) < 1) return false
    if (!query) return true

    const fullName = normalizeSearchText(`${balance.first_name} ${balance.last_name}`)

    if (fullName.includes(query)) return true
    if (digits && digitsOnly(balance.phone).includes(digits)) return true

    return false
  })
}

export type TreatmentGroup = {
  category: string
  items: TreatmentCatalogItem[]
}

/** Catálogo filtrado por código, nombre o categoría. */
export function filterTreatments(
  catalog: TreatmentCatalogItem[],
  query: string,
): TreatmentCatalogItem[] {
  const normalized = normalizeSearchText(query)

  if (!normalized) return catalog

  return catalog.filter((item) =>
    normalizeSearchText(`${item.code} ${item.name} ${item.category}`).includes(normalized),
  )
}

/** Agrupa el catálogo por categoría respetando el orden recibido de la API. */
export function groupTreatmentsByCategory(items: TreatmentCatalogItem[]): TreatmentGroup[] {
  const groups = new Map<string, TreatmentCatalogItem[]>()

  for (const item of items) {
    const category = item.category?.trim() || 'general'
    const bucket = groups.get(category)

    if (bucket) bucket.push(item)
    else groups.set(category, [item])
  }

  return Array.from(groups, ([category, groupItems]) => ({
    category,
    items: [...groupItems].sort((a, b) =>
      a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }),
    ),
  }))
}

/** Saldo resultante que se muestra como vista previa en el modal de cobro. */
export function getBalanceAfter(
  currentBalance: number,
  delta: { kind: 'charge' | 'payment'; total: number; collected: boolean },
): number {
  const current = toFinite(currentBalance)
  const total = Math.max(0, toFinite(delta.total))

  if (delta.kind === 'payment') return current - total

  return delta.collected ? current : current + total
}
