import type { VatRate } from './invoicing-types'

/**
 * Cálculo de IVA en guaraníes.
 *
 * Los precios de la clínica ya incluyen IVA (precio de venta al público). Para
 * despejar el impuesto se usan los divisores de la SET:
 *
 *   IVA 10 %  →  importe / 11
 *   IVA 5 %   →  importe / 21
 *   Exenta    →  sin IVA
 *
 * El guaraní no tiene centavos: el IVA se redondea a 1 ₲ y la base imponible se
 * obtiene por diferencia (importe − IVA), así `base + IVA = importe` siempre.
 */

export const IVA_DIVISORS: Record<'iva_10' | 'iva_5', number> = {
  iva_10: 11,
  iva_5: 21,
}

/** Redondeo a guaraníes (sin decimales). */
export function roundPYG(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0
}

/** Divisor de la franja; `null` en operaciones exentas. */
export function getIvaDivisor(rate: VatRate): number | null {
  if (rate === 'iva_10') return IVA_DIVISORS.iva_10
  if (rate === 'iva_5') return IVA_DIVISORS.iva_5

  return null
}

/** IVA contenido en un importe que ya lo incluye. */
export function computeIva(gross: number, rate: VatRate): number {
  const divisor = getIvaDivisor(rate)

  if (!divisor) return 0

  return roundPYG(Math.max(0, gross) / divisor)
}

export type VatBreakdown = {
  /** Importes con IVA incluido por franja. */
  amount10: number
  amount5: number
  exempt: number
  /** IVA despejado por franja. */
  iva10: number
  iva5: number
  /** Base imponible (importe sin IVA) por franja. */
  net10: number
  net5: number
  total: number
  ivaTotal: number
  netTotal: number
}

/** Desglose completo a partir de importes con IVA incluido. */
export function computeVatBreakdown(input: {
  amount10?: number
  amount5?: number
  exempt?: number
}): VatBreakdown {
  const amount10 = Math.max(0, roundPYG(input.amount10 ?? 0))
  const amount5 = Math.max(0, roundPYG(input.amount5 ?? 0))
  const exempt = Math.max(0, roundPYG(input.exempt ?? 0))

  const iva10 = computeIva(amount10, 'iva_10')
  const iva5 = computeIva(amount5, 'iva_5')
  const total = amount10 + amount5 + exempt
  const ivaTotal = iva10 + iva5

  return {
    amount10,
    amount5,
    exempt,
    iva10,
    iva5,
    net10: amount10 - iva10,
    net5: amount5 - iva5,
    total,
    ivaTotal,
    netTotal: total - ivaTotal,
  }
}

/** Ubica un importe total en la franja elegida. */
export function splitAmountByRate(
  total: number,
  rate: VatRate,
): { amount10: number; amount5: number; exempt: number } {
  const amount = Math.max(0, roundPYG(total))

  return {
    amount10: rate === 'iva_10' ? amount : 0,
    amount5: rate === 'iva_5' ? amount : 0,
    exempt: rate === 'exempt' ? amount : 0,
  }
}

/** Desglose de una factura de un solo importe (cobros de caja/odontograma). */
export function computeInvoiceBreakdown(total: number, rate: VatRate): VatBreakdown {
  return computeVatBreakdown(splitAmountByRate(total, rate))
}

/** IVA total de un desglose ya guardado (facturas y gastos). */
export function getStoredIvaTotal(value: { iva_10: number; iva_5: number }): number {
  return roundPYG((value.iva_10 ?? 0) + (value.iva_5 ?? 0))
}
