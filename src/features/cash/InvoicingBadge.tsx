import { formatPYG } from '../../lib/format'
import type { TransactionInvoicing } from '../invoicing/invoicing-service'
import { INVOICING_STATE_META, getAvailableAmount, getInvoicingState } from './cash-format'

type InvoicingBadgeProps = {
  /** Fila de `transaction_invoicing` del movimiento (sin datos no se muestra). */
  invoicing: TransactionInvoicing | null | undefined
  /** Muestra el importe que queda sin facturar cuando el cobro es parcial. */
  showAvailable?: boolean
  className?: string
}

/**
 * Estado de facturación de un cobro: pendiente, parcialmente facturado o
 * facturado.
 *
 * La caja lo usa para no emitir dos facturas por el mismo dinero: cuando la fila
 * de `transaction_invoicing` todavía no llegó (`invoicing` nulo) no se dibuja
 * nada, así el historial no muestra estados inventados.
 */
export function InvoicingBadge({
  invoicing,
  showAvailable = false,
  className = '',
}: InvoicingBadgeProps) {
  if (!invoicing) return null

  const state = getInvoicingState(invoicing)
  const meta = INVOICING_STATE_META[state]
  const available = getAvailableAmount(invoicing)
  const numbers = invoicing.invoice_numbers.join(', ')

  return (
    <span
      title={numbers ? `Facturas: ${numbers}` : 'Sin facturas asociadas a este cobro'}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${meta.badge} ${className}`}
    >
      {meta.label}
      {showAvailable && state === 'partial' && (
        <span className="tabular-nums">· {formatPYG(available)}</span>
      )}
    </span>
  )
}
