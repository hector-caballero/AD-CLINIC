import { useCallback, useEffect, useState } from 'react'
import { comparePatients, type Patient } from './patient-types'
import { fetchPatients } from './patients-service'

/**
 * Estado del listado de pacientes.
 *
 * Carga una sola vez (más `reload`) y mantiene la lista sincronizada con las
 * altas/ediciones/borrados locales, sin volver a pedir todo a Supabase.
 */
export function usePatients() {
  const [patients, setPatients] = useState<Patient[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isTruncated, setIsTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let isCurrent = true

    fetchPatients()
      .then((snapshot) => {
        if (!isCurrent) return

        setPatients(snapshot.patients)
        setIsTruncated(snapshot.isTruncated)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return

        setError(
          cause instanceof Error ? cause.message : 'No se pudo cargar el listado de pacientes.',
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

  const addPatient = useCallback((patient: Patient) => {
    setPatients((current) => [...current, patient].sort(comparePatients))
  }, [])

  const replacePatient = useCallback((patient: Patient) => {
    setPatients((current) =>
      current.map((item) => (item.id === patient.id ? patient : item)).sort(comparePatients),
    )
  }, [])

  const removePatient = useCallback((patientId: string) => {
    setPatients((current) => current.filter((item) => item.id !== patientId))
  }, [])

  return {
    patients,
    isLoading,
    isTruncated,
    error,
    reload,
    addPatient,
    replacePatient,
    removePatient,
  }
}
