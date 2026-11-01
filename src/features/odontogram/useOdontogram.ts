import { useCallback, useEffect, useState } from 'react'
import {
  addOdontogramItem,
  fetchOdontogram,
  removeOdontogramItem,
  setOdontogramItemStatus,
} from './odontogram-service'
import type { Dentition, OdontogramDraft, OdontogramItem } from './odontogram-types'

type OdontogramState = {
  /** `paciente:dentición` a la que pertenecen los ítems cargados. */
  key: string
  items: OdontogramItem[]
  error: string | null
}

/**
 * Estado del odontograma de un paciente para una dentición.
 *
 * Los ítems se guardan junto a la clave `paciente:dentición`: si cambia el
 * paciente o la dentición, la UI muestra el estado vacío mientras llega la
 * respuesta y nunca los datos del mapa anterior.
 */
export function useOdontogram(patientId: string | null, dentition: Dentition) {
  const [state, setState] = useState<OdontogramState | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const key = patientId ? `${patientId}:${dentition}` : null

  useEffect(() => {
    if (!patientId || !key) return

    let isCurrent = true

    fetchOdontogram(patientId, dentition)
      .then((snapshot) => {
        if (!isCurrent) return

        setState({ key, items: snapshot.items, error: null })
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return

        setState({
          key,
          items: [],
          error:
            cause instanceof Error
              ? cause.message
              : 'No se pudo cargar el odontograma del paciente.',
        })
      })

    return () => {
      isCurrent = false
    }
  }, [patientId, dentition, key, reloadToken])

  const currentState = state?.key === key ? state : null
  const items = currentState?.items ?? []
  const error = currentState?.error ?? null
  const isLoading = Boolean(patientId) && !currentState

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const applyItems = useCallback(
    (updater: (current: OdontogramItem[]) => OdontogramItem[]) => {
      setState((current) => ({
        key: key ?? '',
        items: updater(current?.key === key ? current.items : []),
        error: null,
      }))
    },
    [key],
  )

  /** Guarda un procedimiento nuevo o actualiza el que ya estaba en esa cara. */
  const saveItem = useCallback(
    async (draft: OdontogramDraft) => {
      if (!patientId) throw new Error('Elegí el paciente antes de guardar el procedimiento.')

      const item = await addOdontogramItem({ ...draft, patientId, dentition })

      applyItems((current) => {
        const exists = current.some((row) => row.id === item.id)

        return exists ? current.map((row) => (row.id === item.id ? item : row)) : [...current, item]
      })

      return item
    },
    [patientId, dentition, applyItems],
  )

  const changeStatus = useCallback(
    async (itemId: string, status: OdontogramItem['status']) => {
      const item = await setOdontogramItemStatus(itemId, status)

      applyItems((current) => current.map((row) => (row.id === item.id ? item : row)))

      return item
    },
    [applyItems],
  )

  const removeItem = useCallback(
    async (itemId: string) => {
      await removeOdontogramItem(itemId)

      applyItems((current) => current.filter((item) => item.id !== itemId))
    },
    [applyItems],
  )

  return {
    items,
    isLoading,
    error,
    reload,
    saveItem,
    changeStatus,
    removeItem,
  }
}


