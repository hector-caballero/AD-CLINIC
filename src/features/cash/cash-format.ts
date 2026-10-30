import { formatPYG } from '../../lib/format'
import { pad2, toDateKey } from './cash-dates'
import type { CashMovement, TransactionType } from './cash-types'

/**
 * Formato de montos y saldos de la caja.
 *
 * El guaraní no tiene centavos: todos los importes se muestran con
 * `formatPYG` (₲ + separador de miles) y los inputs aceptan solo dígitos.
 */

/** `315000` → `315.000`; cualquier otro carácter se descarta. */
export function formatAmountInput(value: string): string {
  // `numeric(12, 2)` admite 10 dígitos enteros: se corta ahí para no desbordar.
  const digits = value
    .replace(/\D+/g, '')
    .replace(/^0+(?=\d)/, '')
    .slice(0, 10)

  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** `315.000` → `315000` (0 si el campo está vacío). */
export function parseAmountInput(value: string): number {
  const digits = value.replace(/\D+/g, '')

  if (!digits) return 0

  const amount = Number(digits)

  return Number.isFinite(amount) ? amount : 0
}

/**
 * Monto con signo contable: los pagos suman a caja (+), las devoluciones y los
 * ajustes restan (−) y los cargos se muestran sin signo (generan deuda).
 */
export function formatSignedAmount(type: TransactionType, amount: number): string {
  const formatted = formatPYG(Math.abs(Number.isFinite(amount) ? amount : 0))

  if (type === 'payment') return `+ ${formatted}`
  if (type === 'refund' || type === 'adjustment') return `− ${formatted}`

  return formatted
}

/** Instante que se muestra en el historial: la fecha de pago si existe. */
export function getMovementTimestamp(
  movement: Pick<CashMovement, 'paid_at' | 'created_at'>,
): string {
  return movement.paid_at ?? movement.created_at
}

/**
 * Sugerencia de número de recibo: `REC-20261028-143205`.
 * Es editable en el modal; el índice único de `receipt_number` evita repetidos.
 */
export function buildReceiptSuggestion(now: Date = new Date()): string {
  const date = toDateKey(now).replace(/-/g, '')
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`

  return `REC-${date}-${time}`
}

/** Limpia el número de recibo antes de guardarlo. */
export function normalizeReceiptNumber(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase().slice(0, 40)
}

export type BalanceState = 'debt' | 'credit' | 'clear'

/** Un saldo menor a ₲ 1 se considera saldado. */
export function getBalanceState(balance: number): BalanceState {
  if (!Number.isFinite(balance) || Math.abs(balance) < 1) return 'clear'

  return balance > 0 ? 'debt' : 'credit'
}

export const BALANCE_STATE_META: Record<
  BalanceState,
  { label: string; badge: string; amount: string }
> = {
  debt: {
    label: 'Debe',
    badge: 'bg-amber-50 text-amber-800 ring-amber-200',
    amount: 'text-amber-700',
  },
  credit: {
    label: 'A favor',
    badge: 'bg-sky-50 text-sky-700 ring-sky-200',
    amount: 'text-sky-700',
  },
  clear: {
    label: 'Al día',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amount: 'text-emerald-700',
  },
}
