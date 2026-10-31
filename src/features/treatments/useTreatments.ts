import { useCallback, useEffect, useState } from 'react'
import { compareTreatments, type Treatment } from './treatment-types'
import { fetchTreatments } from './treatments-service'

/**
 * Estado del catálogo de tratamientos.
 *
 * Carga una sola vez (más `reload`) y mantiene la lista sincronizada con las
 * altas/ediciones locales, sin volver a pedir todo a Supabase.
 */
export function useTreatments() {
  const [treatments, setTreatments] = useState<Treatment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isTruncated, setIsTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let isCurrent = true

    fetchTreatments()
      .then((snapshot) => {
        if (!isCurrent) return

        setTreatments(snapshot.treatments)
        setIsTruncated(snapshot.isTruncated)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return

        setError(
          cause instanceof Error
            ? cause.message
            : 'No se pudo cargar el catálogo de tratamientos.',
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

  const addTreatment = useCallback((treatment: Treatment) => {
    setTreatments((current) => [...current, treatment].sort(compareTreatments))
  }, [])

  const replaceTreatment = useCallback((treatment: Treatment) => {
    setTreatments((current) =>
      current.map((item) => (item.id === treatment.id ? treatment : item)).sort(compareTreatments),
    )
  }, [])

  return {
    treatments,
    isLoading,
    isTruncated,
    error,
    reload,
    addTreatment,
    replaceTreatment,
  }
}
