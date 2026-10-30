import { useCallback, useEffect, useState } from 'react'
import { fetchPatientAccount } from './cash-service'
import type { CashMovement, PatientBalance } from './cash-types'

type AccountSnapshot = {
  requestKey: string
  balance: PatientBalance | null
  movements: CashMovement[]
}

/**
 * Estado de cuenta de un paciente (`patient_balances` + movimientos).
 *
 * Mientras llega la respuesta se muestra el saldo que ya tenía la pantalla
 * (`initialBalance`), así el panel abre con datos en vez de un esqueleto.
 */
export function usePatientAccount(patientId: string, initialBalance: PatientBalance | null = null) {
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const requestKey = `${patientId}|${reloadToken}`
  const isLoading = snapshot?.requestKey !== requestKey

  useEffect(() => {
    let isCurrent = true

    fetchPatientAccount(patientId)
      .then((result) => {
        if (!isCurrent) return

        setSnapshot({
          requestKey,
          balance: result.balance,
          movements: result.movements,
        })
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return

        setError(
          cause instanceof Error ? cause.message : 'No se pudo cargar el estado de cuenta.',
        )
      })

    return () => {
      isCurrent = false
    }
  }, [patientId, requestKey])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  return {
    balance: (isLoading ? initialBalance : snapshot?.balance) ?? initialBalance,
    movements: isLoading ? [] : (snapshot?.movements ?? []),
    isLoading,
    error,
    reload,
  }
}
