import { useCallback, useEffect, useState } from 'react'
import { fetchTreatmentsCatalog } from './cash-service'
import type { TreatmentCatalogItem } from './cash-types'

/** Catálogo de tratamientos activos para el modal de cobro. */
export function useTreatmentsCatalog() {
  const [catalog, setCatalog] = useState<TreatmentCatalogItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let isCurrent = true

    fetchTreatmentsCatalog()
      .then((items) => {
        if (!isCurrent) return

        setCatalog(items)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return

        setError(
          cause instanceof Error ? cause.message : 'No se pudo cargar el catálogo de tratamientos.',
        )
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [reloadToken])

  const reload = useCallback(() => {
    setIsLoading(true)
    setReloadToken((token) => token + 1)
  }, [])

  return { catalog, isLoading, error, reload }
}
