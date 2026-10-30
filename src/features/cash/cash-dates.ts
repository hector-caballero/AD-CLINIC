import type { CashPeriod } from './cash-types'

/**
 * Fechas y rangos del módulo de caja.
 *
 * `transactions.created_at`/`paid_at` son `timestamptz`, así que los rangos se
 * construyen como instantes ISO a partir de la medianoche **local** del
 * navegador. Las claves de día se arman con los getters locales (nunca con
 * `toISOString()`), para que un movimiento de las 22:00 no caiga en el día
 * siguiente por el huso horario.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export type CashRange = {
  /** Inicio inclusivo del rango (`null` = sin límite inferior). */
  fromIso: string | null
  /** Fin exclusivo del rango (`null` = sin límite superior). */
  toIso: string | null
  /** Texto corto para el encabezado del historial. */
  label: string
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** `2026-10-28` en hora local. */
export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function todayKey(now: Date = new Date()): string {
  return toDateKey(now)
}

/** `2026-10-28` → `28/10/2026`. */
export function formatDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.slice(0, 10).split('-')

  if (!year || !month || !day) return '—'

  return `${day}/${month}/${year}`
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function startOfLocalMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate())
}

/** `Octubre de 2026`. */
export function formatMonthLabel(date: Date): string {
  const formatted = new Intl.DateTimeFormat('es-PY', {
    month: 'long',
    year: 'numeric',
  }).format(date)

  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

/** Fecha local de un instante ISO (`2026-10-28T15:32:00Z` → `28/10/2026`). */
export function formatMovementDate(iso: string | null | undefined): string {
  if (!iso) return '—'

  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) return '—'

  return formatDateKey(toDateKey(date))
}

/** Hora local de un instante ISO (`14:32`). */
export function formatMovementTime(iso: string | null | undefined): string {
  if (!iso) return ''

  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) return ''

  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/**
 * Rango del historial según el período elegido.
 *
 * - `today`: el día en curso.
 * - `month`: el mes calendario en curso.
 * - `30d`: los últimos 30 días (hoy incluido).
 * - `all`: sin filtros (se apoya en el `limit` de la consulta).
 */
export function buildCashRange(period: CashPeriod, now: Date = new Date()): CashRange {
  const startOfToday = startOfLocalDay(now)
  const startOfTomorrow = addDays(startOfToday, 1)

  if (period === 'today') {
    return {
      fromIso: startOfToday.toISOString(),
      toIso: startOfTomorrow.toISOString(),
      label: `Hoy · ${formatDateKey(toDateKey(startOfToday))}`,
    }
  }

  if (period === 'month') {
    const monthStart = startOfLocalMonth(now)
    const monthEnd = addMonths(monthStart, 1)

    return {
      fromIso: monthStart.toISOString(),
      toIso: monthEnd.toISOString(),
      label: formatMonthLabel(monthStart),
    }
  }

  if (period === '30d') {
    return {
      fromIso: addDays(startOfToday, -29).toISOString(),
      toIso: startOfTomorrow.toISOString(),
      label: 'Últimos 30 días',
    }
  }

  return { fromIso: null, toIso: null, label: 'Todo el historial' }
}
