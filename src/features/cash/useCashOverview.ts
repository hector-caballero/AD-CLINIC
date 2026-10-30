import { useCallback, useEffect, useState } from 'react'
import { computeCashMetrics, type CashMetrics } from './cash-metrics'
import { fetchCashOverview } from './cash-service'
import type { CashOverview, PatientBalance } from './cash-types'

type OverviewSnapshot = {
  reloadToken: number
  metrics: CashMetrics
  balances: PatientBalance[]
}

/** Referencia estable mientras no hay datos (evita re-renders del panel). */
const EMPTY_BALANCES: PatientBalance[] = []

/**
 * Resumen de caja: métricas de las tarjetas y saldos de la vista
 * `patient_balances`. Las métricas se calculan una vez por carga, con la fecha
 * del momento en que llegó la respuesta.
 */
export function useCashOverview() {
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const isLoading = snapshot?.reloadToken !== reloadToken

  useEffect(() => {
    let isCurrent = true

    fetchCashOverview()
      .then((overview: CashOverview) => {
        if (!isCurrent) return

        setSnapshot({
          reloadToken,
          metrics: computeCashMetrics(overview),
          balances: overview.balances,
        })
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return

        setError(
          cause instanceof Error ? cause.message : 'No se pudo cargar el resumen de caja.',
        )
      })

    return () => {
      isCurrent = false
    }
  }, [reloadToken])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  return {
    metrics: snapshot?.metrics ?? null,
    balances: snapshot?.balances ?? EMPTY_BALANCES,
    isLoading,
    error,
    reload,
  }
}
