import { formatPYG, formatShortDate } from '../../lib/format'
import { getTodayKey } from './invoicing-format'
import type { InvoiceCondition, InvoiceInstallment } from './invoicing-types'

/**
 * Plan de pagos de una factura.
 *
 * El guaraní no tiene centavos, así que las cuotas se reparten en enteros: las
 * primeras absorben el resto de la división y la suma siempre coincide con el
 * total de la factura (la base rechaza un plan que no cuadre).
 */

/** Tope de cuotas, igual al `check` de `invoices.installments_count`. */
export const MAX_INSTALLMENTS = 60

/** `2026-12-10` a medianoche local (sin desfase de zona horaria). */
function parseDateKey(dateKey: string): Date | null {
  const [year, month, day] = dateKey.slice(0, 10).split('-').map(Number)

  if (!year || !month || !day) return null

  const date = new Date(year, month - 1, day)

  return Number.isNaN(date.getTime()) ? null : date
}

/** Suma meses a una fecha `YYYY-MM-DD`, recortando al último día del mes. */
export function addMonthsToDateKey(dateKey: string, months: number): string {
  const date = parseDateKey(dateKey) ?? new Date()
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()

  target.setDate(Math.min(date.getDate(), lastDay))

  return getTodayKey(target)
}

/** Cuota a emitir / guardar (sin id: todavía no existe en la base). */
export type InstallmentDraft = {
  number: number
  due_date: string
  amount: number
}

/**
 * Reparte `total` en `count` cuotas mensuales desde `firstDueDate`.
 *
 * El resto de la división se carga en las primeras cuotas para que la suma dé
 * exactamente el total. Si el total es menor a la cantidad de cuotas, se
 * recorta la cantidad (no se generan cuotas de ₲ 0).
 */
export function buildInstallmentPlan(
  total: number,
  count: number,
  firstDueDate: string,
): InstallmentDraft[] {
  const safeTotal = Math.max(Math.round(total), 0)

  if (safeTotal <= 0) return []

  const safeCount = Math.min(
    Math.max(Math.round(count) || 1, 1),
    MAX_INSTALLMENTS,
    safeTotal,
  )
  const base = Math.floor(safeTotal / safeCount)
  const remainder = safeTotal - base * safeCount

  return Array.from({ length: safeCount }, (_, index) => ({
    number: index + 1,
    due_date: addMonthsToDateKey(firstDueDate, index),
    amount: base + (index < remainder ? 1 : 0),
  }))
}

/** Suma de las cuotas del borrador (debe igualar el total de la factura). */
export function getPlanTotal(plan: InstallmentDraft[]): number {
  return plan.reduce((sum, item) => sum + item.amount, 0)
}

/** Primer vencimiento sugerido: hoy al contado, dentro de un mes a crédito. */
export function suggestFirstDueDate(
  condition: InvoiceCondition,
  now: Date = new Date(),
): string {
  const today = getTodayKey(now)

  return condition === 'credito' ? addMonthsToDateKey(today, 1) : today
}

/** `Cuota 2/6 · vence 10/12/2026`. */
export function getInstallmentLabel(
  installment: Pick<InvoiceInstallment, 'number' | 'due_date' | 'amount'>,
  count: number,
): string {
  const total = count > 0 ? `/${count}` : ''

  return `Cuota ${installment.number}${total} · vence ${formatShortDate(installment.due_date)}`
}

/** `₲ 150.000 × 6 cuotas`. */
export function getInstallmentPlanSummary(plan: InstallmentDraft[]): string {
  if (plan.length === 0) return 'Sin cuotas'

  const amounts = new Set(plan.map((item) => item.amount))

  if (amounts.size === 1) {
    return `${formatPYG(plan[0]?.amount ?? 0)} × ${plan.length} ${plan.length === 1 ? 'cuota' : 'cuotas'}`
  }

  return `${plan.length} cuotas · ${formatPYG(getPlanTotal(plan))}`
}
