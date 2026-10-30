import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildCashRange, type CashRange } from './cash-dates'
import { fetchMovements } from './cash-service'
import type { CashMovement, CashPeriod } from './cash-types'

type MovementsSnapshot = {
  requestKey: string
  movements: CashMovement[]
}

/**
 * Historial de movimientos del período elegido.
 *
 * Se vuelve a consultar cuando cambia el período o se llama a `reload`; el
 * resto de la pantalla se sincroniza recargando el resumen.
 */
export function useCashMovements(period: CashPeriod) {
  const [snapshot, setSnapshot] = useState<MovementsSnapshot>({
    requestKey: '',
    movements: [],
  })
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const range: CashRange = useMemo(() => buildCashRange(period), [period])
  const requestKey = `${period}|${reloadToken}`
  const isLoading = snapshot.requestKey !== requestKey
  const movements = isLoading ? [] : snapshot.movements

  useEffect(() => {
    let isCurrent = true

    fetchMovements(range)
      .then((rows) => {
        if (!isCurrent) return

        setSnapshot({ requestKey, movements: rows })
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return

        setError(
          cause instanceof Error ? cause.message : 'No se pudo cargar el historial de movimientos.',
        )
      })

    return () => {
      isCurrent = false
    }
  }, [range, requestKey])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  return { movements, range, isLoading, error, reload }
}
