import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { supabase } from '../../lib/supabase'
import { buildAgendaRange, todayKey } from '../appointments/appointment-dates'
import type { AppointmentWithPatient } from '../appointments/appointment-types'
import type { StaffNameMap } from '../team/staff-directory'
import { fetchWaitingRoomAppointments, fetchWaitingRoomStaff } from './tv-service'
import { TV_EVENT_DEBOUNCE_MS, TV_REFRESH_INTERVAL_MS } from './tv-types'

/**
 * Sincronización de la pantalla de sala.
 *
 * - Carga las citas del día (`checked_in` + `completed`) y el directorio del
 *   equipo.
 * - Escucha `postgres_changes` en el canal `public:appointments`: cualquier
 *   cambio que afecte al día pide una recarga (agrupada cada 250 ms). Se
 *   reconsulta en lugar de aplicar el payload porque Realtime manda solo las
 *   columnas de la tabla, sin el paciente embebido (`patient:patients(...)`).
 * - Refresco de respaldo cada 5 minutos, al volver a la pestaña y al recuperar
 *   la conexión: una tele encendida días no puede quedar congelada si el canal
 *   se cae sin emitir error.
 * - A medianoche cambia el día consultado (rollover del turnero).
 *
 * Todas las señales (Realtime, temporizador, foco de la pestaña, botón
 * «Actualizar») avanzan el mismo contador `reloadToken`: la consulta vive en un
 * único efecto y así no hay cargas en paralelo ni estados a medio actualizar.
 */

/** `connecting` antes del primer `SUBSCRIBED`; `offline` sin red. */
export type WaitingRoomConnection = 'connecting' | 'live' | 'offline' | 'error'

type ChannelState = 'connecting' | 'live' | 'error'

/** Payload mínimo de `postgres_changes` que necesita el turnero. */
type AppointmentChange = {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: { starts_at?: string } | Record<string, never>
  old: { starts_at?: string } | Record<string, never>
}

export type WaitingRoomState = {
  appointments: AppointmentWithPatient[]
  staffNames: StaffNameMap
  connection: WaitingRoomConnection
  /** Error de carga (la pantalla muestra el estado de error). */
  error: string | null
  /** Aviso no bloqueante: migración pendiente o canal perdido. */
  warning: string | null
  /** Última sincronización correcta. */
  lastSync: Date | null
  /** `false` mientras no llegó la primera respuesta. */
  hasLoaded: boolean
  /** Fuerza una recarga ahora (botón «Actualizar»). */
  reload: () => void
}

const MIGRATION_WARNING =
  'Falta aplicar la migración 20261110100000_waiting_room_display.sql: la sala funciona sin consultorio ni avisos de llamada en tiempo real.'

const CHANNEL_WARNING =
  'Se perdió el canal de Realtime: la pantalla se refresca cada 5 minutos. Revisá la conexión de la tele.'

export function useWaitingRoom(): WaitingRoomState {
  const [dayKey, setDayKey] = useState(() => todayKey())
  const [appointments, setAppointments] = useState<AppointmentWithPatient[]>([])
  const [staffNames, setStaffNames] = useState<StaffNameMap>({})
  const [channelState, setChannelState] = useState<ChannelState>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const isOnline = useOnlineStatus()
  const debounceRef = useRef<number | null>(null)

  const range = useMemo(() => buildAgendaRange('day', dayKey), [dayKey])

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  // Rollover: a medianoche el turnero pasa al día siguiente sin recargar la app.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setDayKey((current) => {
        const next = todayKey()

        return next === current ? current : next
      })
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [])

  // Consulta del día (también es el refresco de respaldo al volver a la pestaña
  // o recuperar la red). Sin directorio la tele funciona: solo pierde el
  // profesional asignado.
  useEffect(() => {
    let isCurrent = true

    Promise.all([
      fetchWaitingRoomAppointments(range.startIso, range.endIso),
      fetchWaitingRoomStaff().catch(() => ({} as StaffNameMap)),
    ])
      .then(([room, directory]) => {
        if (!isCurrent) return

        setAppointments(room.appointments)
        setStaffNames(directory)
        setNeedsMigration(room.needsMigration)
        setLastSync(new Date())
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return

        setError(
          cause instanceof Error
            ? cause.message
            : 'No se pudo cargar la sala de espera. Revisá la conexión de la tele.',
        )
      })

    return () => {
      isCurrent = false
    }
  }, [range.startIso, range.endIso, reloadToken])

  // Refresco periódico y al recuperar el foco: cualquiera de los dos avanza el
  // contador y dispara la consulta de arriba.
  useEffect(() => {
    const timer = window.setInterval(
      () => setReloadToken((token) => token + 1),
      TV_REFRESH_INTERVAL_MS,
    )
    const handleOnline = () => setReloadToken((token) => token + 1)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') setReloadToken((token) => token + 1)
    }

    window.addEventListener('online', handleOnline)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('online', handleOnline)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  // Realtime: los cambios de la agenda son el disparador del turnero.
  useEffect(() => {
    const isInRange = (value?: string) =>
      typeof value === 'string' && value >= range.startIso && value < range.endIso

    const scheduleReload = () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)

      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null
        setReloadToken((token) => token + 1)
      }, TV_EVENT_DEBOUNCE_MS)
    }

    const handleChange = (payload: AppointmentChange) => {
      // Solo interesa lo que toca al día mostrado: el filtro del canal corta por
      // `starts_at`, pero el paciente puede moverse de día al reprogramar.
      if (payload.eventType === 'DELETE') {
        if (isInRange(payload.old.starts_at)) scheduleReload()

        return
      }

      if (isInRange(payload.new.starts_at) || isInRange(payload.old.starts_at)) {
        scheduleReload()
      }
    }

    const channel = supabase
      .channel('public:appointments')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'appointments',
          filter: `starts_at=gte.${range.startIso}`,
        },
        handleChange,
      )
      .subscribe((nextStatus) => {
        if (nextStatus === 'SUBSCRIBED') {
          setChannelState('live')

          // Al (re)conectar se recupera lo que pasó mientras estaba caído.
          setReloadToken((token) => token + 1)
        } else if (nextStatus === 'CHANNEL_ERROR' || nextStatus === 'TIMED_OUT') {
          setChannelState('error')
        } else if (nextStatus === 'CLOSED') {
          setChannelState('connecting')
        }
      })

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }

      void supabase.removeChannel(channel)
    }
  }, [range.startIso, range.endIso])

  const connection: WaitingRoomConnection = !isOnline
    ? 'offline'
    : channelState === 'live'
      ? 'live'
      : channelState === 'error'
        ? 'error'
        : 'connecting'

  const warning = needsMigration
    ? MIGRATION_WARNING
    : channelState === 'error'
      ? CHANNEL_WARNING
      : null

  return {
    appointments,
    staffNames,
    connection,
    error,
    warning,
    lastSync,
    hasLoaded: lastSync !== null,
    reload,
  }
}
