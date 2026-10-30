import { useCallback, useEffect, useState } from 'react'
import { fetchAppointments } from './appointments-service'
import {
  compareAppointments,
  type Appointment,
  type AppointmentWithPatient,
} from './appointment-types'

type UseAppointmentsOptions = {
  /** Inicio del rango como instante ISO. */
  fromIso: string
  /** Fin exclusivo del rango como instante ISO. */
  toIso: string
}

/**
 * Citas del rango visible.
 *
 * Se vuelve a consultar cuando cambia el rango (navegación o cambio de vista).
 * Las altas/ediciones/cambios de estado se reflejan en memoria con
 * `applyAppointment`, sin recargar toda la agenda.
 */
export function useAppointments({ fromIso, toIso }: UseAppointmentsOptions) {
  const [snapshot, setSnapshot] = useState<{
    requestKey: string
    appointments: AppointmentWithPatient[]
  }>({ requestKey: '', appointments: [] })
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  /**
   * Clave de la consulta en curso. Si no coincide con la última respuesta, la
   * agenda está cargando: así no hace falta `setState` al inicio del efecto.
   */
  const requestKey = `${fromIso}|${toIso}|${reloadToken}`
  const isLoading = snapshot.requestKey !== requestKey
  const appointments = isLoading ? [] : snapshot.appointments

  useEffect(() => {
    let isCurrent = true

    fetchAppointments(fromIso, toIso)
      .then((rows) => {
        if (!isCurrent) return

        setSnapshot({ requestKey, appointments: rows })
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return

        setError(
          cause instanceof Error ? cause.message : 'No se pudo cargar la agenda de citas.',
        )
      })

    return () => {
      isCurrent = false
    }
  }, [fromIso, toIso, requestKey])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  /** Inserta o reemplaza una cita con la fila devuelta por Supabase. */
  const applyAppointment = useCallback((appointment: AppointmentWithPatient) => {
    setSnapshot((current) => {
      const others = current.appointments.filter((item) => item.id !== appointment.id)

      return {
        ...current,
        appointments: [...others, appointment].sort(compareAppointments),
      }
    })
  }, [])

  /** Aplica un cambio parcial (p. ej. `reminder_sent_at`) sin volver a pedir. */
  const patchAppointment = useCallback(
    (id: string, patch: Partial<Pick<Appointment, 'reminder_sent_at' | 'updated_at'>>) => {
      setSnapshot((current) => ({
        ...current,
        appointments: current.appointments.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      }))
    },
    [],
  )

  return { appointments, isLoading, error, reload, applyAppointment, patchAppointment }
}
