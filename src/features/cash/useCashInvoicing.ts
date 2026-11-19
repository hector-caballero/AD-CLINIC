import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchTransactionInvoicing,
  type TransactionInvoicing,
} from '../invoicing/invoicing-service'
import type { CashMovement } from './cash-types'

type InvoicingSnapshot = {
  requestKey: string
  byTransaction: Map<string, TransactionInvoicing>
}

const EMPTY_MAP = new Map<string, TransactionInvoicing>()

/**
 * Tope de ids por consulta: el historial de caja llega a 500 movimientos y un
 * `.in()` con todos ellos arma una URL demasiado larga para PostgREST.
 */
const INVOICING_CHUNK_SIZE = 100

/**
 * Estado de facturación (`transaction_invoicing`) de los cobros recibidos.
 *
 * Solo se consultan los pagos (los cargos y ajustes no se facturan) y se indexa
 * por `transaction_id` para que la tabla resuelva el badge de cada fila en O(1).
 * `reload` vuelve a consultar sin cambiar el período del historial.
 */
export function useCashInvoicing(movements: CashMovement[]) {
  const idsKey = useMemo(
    () =>
      movements
        .filter((movement) => movement.type === 'payment')
        .map((movement) => movement.id)
        .join(','),
    [movements],
  )
  const transactionIds = useMemo(() => (idsKey ? idsKey.split(',') : []), [idsKey])
  const [snapshot, setSnapshot] = useState<InvoicingSnapshot>({
    requestKey: '',
    byTransaction: EMPTY_MAP,
  })
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const requestKey = `${idsKey}|${reloadToken}`
  const isLoading = snapshot.requestKey !== requestKey

  useEffect(() => {
    let isCurrent = true
    const chunks: string[][] = []

    for (let index = 0; index < transactionIds.length; index += INVOICING_CHUNK_SIZE) {
      chunks.push(transactionIds.slice(index, index + INVOICING_CHUNK_SIZE))
    }

    Promise.all(chunks.map((chunk) => fetchTransactionInvoicing(chunk)))
      .then((results) => {
        if (!isCurrent) return

        setSnapshot({
          requestKey,
          byTransaction: new Map(
            results.flat().map((row) => [row.transaction_id, row] as const),
          ),
        })
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return

        setError(
          cause instanceof Error
            ? cause.message
            : 'No se pudo cargar el estado de facturación de los cobros.',
        )
      })

    return () => {
      isCurrent = false
    }
  }, [transactionIds, requestKey])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  return { invoicing: snapshot.byTransaction, isLoading, error, reload }
}
