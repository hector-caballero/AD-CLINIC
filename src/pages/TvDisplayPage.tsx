import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Expand, RefreshCw, Shrink, Volume2, VolumeX } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Brand } from '../components/layout/Brand'
import { formatDayHeading, todayKey } from '../features/appointments/appointment-dates'
import {
  announceCall,
  readSoundEnabled,
  saveSoundEnabled,
  stopSpeaking,
  testTvAudio,
} from '../features/tv/tv-announcer'
import { buildWaitingRoomSnapshot } from '../features/tv/tv-queue'
import { TV_CALL_WINDOW_MINUTES, type WaitingRoomEntry } from '../features/tv/tv-types'
import { WaitingRoomHero } from '../features/tv/WaitingRoomHero'
import { WaitingRoomSidebar } from '../features/tv/WaitingRoomSidebar'
import { useWaitingRoom, type WaitingRoomConnection } from '../features/tv/useWaitingRoom'

/**
 * Pantalla de sala (modo TV / turnero).
 *
 * Vista de pantalla completa para el televisor de la recepción:
 * - reloj en vivo y estado del canal de Realtime;
 * - tarjeta gigante con el paciente llamado (pulso dorado al llamar);
 * - panel lateral con los que esperan y los últimos atendidos;
 * - campanilla + voz al detectar una llamada nueva.
 *
 * Se alimenta de `useWaitingRoom` (Supabase + `public:appointments`) y se deriva
 * de la agenda: no hay estados nuevos en la base, solo `checked_in` y `called_at`.
 */

const ICON_BUTTON =
  'inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition-colors hover:bg-white/10 hover:text-white'

const LINK_BUTTON =
  'inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white'

/** Una llamada más vieja que esto no se anuncia al encender la tele. */
const FRESH_CALL_MINUTES = Math.min(2, TV_CALL_WINDOW_MINUTES)

const CONNECTION_META: Record<
  WaitingRoomConnection,
  { label: string; dot: string; text: string }
> = {
  live: { label: 'En vivo', dot: 'bg-emerald-400', text: 'text-emerald-300' },
  connecting: { label: 'Conectando…', dot: 'bg-amber-300', text: 'text-amber-200' },
  offline: { label: 'Sin conexión', dot: 'bg-amber-400', text: 'text-amber-200' },
  error: { label: 'Reconectando…', dot: 'bg-rose-400', text: 'text-rose-300' },
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatClock(now: Date): string {
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
}

function formatTimeWithSeconds(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/** `true` si la llamada es de los últimos minutos (no se repite al abrir). */
function isFreshCall(calledAt: string, now: Date): boolean {
  const time = new Date(calledAt).getTime()

  if (Number.isNaN(time)) return false

  return (now.getTime() - time) / 60_000 <= FRESH_CALL_MINUTES
}

export default function TvDisplayPage() {
  const { appointments, staffNames, connection, error, warning, lastSync, hasLoaded, reload } =
    useWaitingRoom()

  const [now, setNow] = useState(() => new Date())
  const [soundEnabled, setSoundEnabled] = useState(() => readSoundEnabled())
  const [isFullscreen, setIsFullscreen] = useState(false)

  /** El anuncio se dispara desde un efecto: el flag va en ref para no repetirlo. */
  const soundEnabledRef = useRef(soundEnabled)
  /** Firma `id|called_at` de la última llamada anunciada. */
  const lastAnnouncedRef = useRef<string | null>(null)
  /** La primera carga solo fija la línea base (no anuncia llamadas viejas). */
  const baselineRef = useRef(false)

  // Reloj de la cabecera: 1 s (segundos + «hace X minutos»).
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'AD Clinic · Sala de espera'

    return () => {
      document.title = previousTitle
    }
  }, [])

  useEffect(() => {
    const handleChange = () => setIsFullscreen(document.fullscreenElement !== null)

    document.addEventListener('fullscreenchange', handleChange)

    return () => document.removeEventListener('fullscreenchange', handleChange)
  }, [])

  useEffect(() => {
    soundEnabledRef.current = soundEnabled
  }, [soundEnabled])

  // Al desmontar (o cerrar la pestaña) se corta cualquier locución pendiente.
  useEffect(() => {
    return () => stopSpeaking()
  }, [])

  // El estado de la sala se recalcula por minuto: alcanza para las fases y evita
  // reordenar las listas en cada tick del reloj.
  const minuteStamp = Math.floor(now.getTime() / 60_000)
  const queueNow = useMemo(() => new Date(minuteStamp * 60_000), [minuteStamp])

  const snapshot = useMemo(
    () => buildWaitingRoomSnapshot(appointments, { staffNames, now: queueNow }),
    [appointments, staffNames, queueNow],
  )

  const attendedToday = appointments.filter((item) => item.status === 'completed').length

  const announce = useCallback((entry: WaitingRoomEntry) => {
    if (!soundEnabledRef.current) return

    announceCall(entry.patientName, entry.room)
  }, [])

  // Aviso sonoro: una llamada nueva es una firma nueva (`id|called_at`), así
  // volver a llamar al mismo paciente también suena.
  useEffect(() => {
    if (!hasLoaded) return

    const current = snapshot.current
    const calledAt = current?.appointment.called_at ?? null
    const signature = current && calledAt ? `${current.appointment.id}|${calledAt}` : null

    if (!baselineRef.current) {
      baselineRef.current = true
      lastAnnouncedRef.current = signature

      // Si la tele se encendió justo durante una llamada, se anuncia igual.
      if (current && calledAt && isFreshCall(calledAt, queueNow)) announce(current)

      return
    }

    if (!signature || signature === lastAnnouncedRef.current) return

    lastAnnouncedRef.current = signature

    if (current) announce(current)
  }, [hasLoaded, snapshot, queueNow, announce])

  function handleToggleSound() {
    const next = !soundEnabled

    setSoundEnabled(next)
    saveSoundEnabled(next)

    if (next) {
      // El clic es el gesto que desbloquea el audio del navegador.
      testTvAudio()
    } else {
      stopSpeaking()
    }
  }

  async function handleToggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await document.documentElement.requestFullscreen()
      }
    } catch {
      // Algunos navegadores solo permiten pantalla completa con otra tecla (F11).
    }
  }

  const meta = CONNECTION_META[connection]

  return (
    <div className="flex min-h-svh flex-col gap-4 bg-ink-950 bg-[radial-gradient(60rem_38rem_at_8%_-12%,rgba(212,175,55,0.16),transparent_58%),radial-gradient(48rem_32rem_at_100%_0%,rgba(154,123,86,0.14),transparent_60%)] px-4 py-4 text-white sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-white/10 bg-white/[0.03] px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Brand size={40} />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.22em] text-brand-300/90 uppercase">
              AD Clinic
            </p>
            <p className="truncate text-sm text-slate-300">Sala de espera</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <div className="text-right">
            <p className="text-3xl font-semibold tabular-nums text-white sm:text-4xl">
              {formatClock(now)}
              <span className="ml-0.5 text-sm font-medium text-brand-300">
                :{pad2(now.getSeconds())}
              </span>
            </p>
            <p className="text-xs text-slate-400">{formatDayHeading(todayKey(now))}</p>
          </div>

          <span
            role="status"
            aria-live="polite"
            title={
              lastSync
                ? `Última sincronización: ${formatTimeWithSeconds(lastSync)}`
                : 'Todavía sin sincronizar'
            }
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium"
          >
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${meta.dot} ${
                connection === 'live' ? 'motion-safe:animate-pulse' : ''
              }`}
            />
            <span className={meta.text}>{meta.label}</span>
          </span>

          <div className="flex items-center gap-1.5">
            <Link to="/citas" title="Volver a la agenda" className={LINK_BUTTON}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Agenda</span>
            </Link>

            <button
              type="button"
              onClick={handleToggleSound}
              aria-pressed={soundEnabled}
              title={
                soundEnabled
                  ? 'Silenciar los avisos de llamada'
                  : 'Activar la campanilla y la voz de los avisos'
              }
              aria-label={soundEnabled ? 'Silenciar avisos' : 'Activar avisos'}
              className={ICON_BUTTON}
            >
              {soundEnabled ? (
                <Volume2 className="size-4" aria-hidden="true" />
              ) : (
                <VolumeX className="size-4" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              onClick={reload}
              title="Actualizar ahora"
              aria-label="Actualizar ahora"
              className={ICON_BUTTON}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={handleToggleFullscreen}
              aria-pressed={isFullscreen}
              title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
              aria-label={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
              className={ICON_BUTTON}
            >
              {isFullscreen ? (
                <Shrink className="size-4" aria-hidden="true" />
              ) : (
                <Expand className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </header>

      {warning && (
        <p
          role="status"
          className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-xs leading-relaxed text-amber-100"
        >
          {warning}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-100"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={reload}
            className="font-semibold underline underline-offset-2 hover:text-white"
          >
            Reintentar
          </button>
        </p>
      )}

      {!hasLoaded && !error ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-1 flex-col items-center justify-center gap-3 rounded-3xl border border-white/10 bg-white/[0.02] py-24"
        >
          <span
            aria-hidden="true"
            className="size-8 animate-spin rounded-full border-2 border-brand-400/30 border-t-brand-400"
          />
          <p className="text-sm text-slate-400">Conectando con la sala de espera…</p>
        </div>
      ) : !hasLoaded ? (
        <div className="flex flex-1 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.02] px-6 py-24 text-center">
          <p className="max-w-md text-sm leading-relaxed text-slate-400">
            No pudimos cargar la sala. La pantalla reintenta sola cada 5 minutos; también podés
            usar el botón de actualizar de la cabecera.
          </p>
        </div>
      ) : (
        <main className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_27rem]">
          <div className="flex min-h-0 flex-col gap-4">
            <WaitingRoomHero
              entry={snapshot.current}
              waitingCount={snapshot.waiting.length}
              now={now}
            />

            <dl className="grid grid-cols-3 gap-3">
              {[
                { label: 'En sala', value: snapshot.inRoom },
                { label: 'En espera', value: snapshot.waiting.length },
                { label: 'Atendidos hoy', value: attendedToday },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
                >
                  <dt className="text-[11px] font-semibold tracking-[0.18em] text-slate-500 uppercase">
                    {stat.label}
                  </dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums text-white">
                    {stat.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <WaitingRoomSidebar
            waiting={snapshot.waiting}
            inProgress={snapshot.inProgress}
            attended={snapshot.attended}
          />
        </main>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-[11px] text-slate-500">
        <span>
          Los llamados se hacen desde la agenda con «Llamar a sala»
          {lastSync ? ` · Última sincronización ${formatTimeWithSeconds(lastSync)}` : ''}.
        </span>
        <span className="tracking-[0.18em] text-bronze-400/80 uppercase">
          AD Clinic · Modo TV
        </span>
      </footer>
    </div>
  )
}
