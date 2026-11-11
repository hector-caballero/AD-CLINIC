import { BellRing, Clock3, DoorOpen, Stethoscope, UserRound } from 'lucide-react'
import { TV_PHASE_META, type WaitingRoomEntry } from './tv-types'

type WaitingRoomHeroProps = {
  /** Llamada vigente (la más reciente de la sala). */
  entry: WaitingRoomEntry | null
  /** Pacientes esperando sin llamar (para el estado sin llamada). */
  waitingCount: number
  /** Reloj de la pantalla: mantiene «hace X min» al día. */
  now: Date
}

const CARD_BASE =
  'relative overflow-hidden rounded-3xl border p-6 transition-colors duration-500 sm:p-8 lg:p-10'

/** Borde dorado + halo pulsante mientras la llamada está vigente. */
const CARD_CALLING =
  'border-brand-400/70 bg-gradient-to-br from-ink-900 via-ink-950 to-ink-900 shadow-[0_0_0_1px_rgba(212,175,55,0.35),0_40px_120px_-40px_rgba(212,175,55,0.55)]'

const CARD_IDLE = 'border-white/10 bg-white/[0.03]'

const CHIP =
  'inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-sm text-slate-300'

function minutesSinceCall(entry: WaitingRoomEntry, now: Date): number {
  if (!entry.appointment.called_at) return 0

  const calledAt = new Date(entry.appointment.called_at).getTime()

  if (Number.isNaN(calledAt)) return 0

  return Math.max(0, Math.floor((now.getTime() - calledAt) / 60_000))
}

function callAgeLabel(entry: WaitingRoomEntry, now: Date): string {
  const minutes = minutesSinceCall(entry, now)

  if (minutes < 1) return 'recién'
  if (minutes === 1) return 'hace 1 minuto'

  return `hace ${minutes} minutos`
}

/**
 * Tarjeta gigante con el paciente llamado.
 *
 * Cuando la llamada es reciente (fase `calling`) se activa el pulso dorado; si
 * el paciente ya pasó al consultorio (`in_progress`) la tarjeta queda sobria
 * para no seguir «llamando» a alguien que ya entró.
 */
export function WaitingRoomHero({ entry, waitingCount, now }: WaitingRoomHeroProps) {
  const isCalling = entry?.phase === 'calling'
  const phaseMeta = entry?.phase ? TV_PHASE_META[entry.phase] : null

  return (
    <section
      aria-label={entry ? `Llamada en curso: ${entry.patientName}` : 'Sala de espera'}
      className={`${CARD_BASE} ${isCalling ? CARD_CALLING : CARD_IDLE}`}
    >
      {isCalling && (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-3xl ring-2 ring-brand-400/60 motion-safe:animate-tv-ring"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-brand-500/20 blur-3xl"
          />
        </>
      )}

      <div className="relative flex flex-wrap items-center gap-2">
        <span
          className={[
            'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold tracking-[0.16em] uppercase',
            isCalling
              ? 'bg-brand-500 text-ink-950'
              : 'border border-white/10 bg-white/[0.04] text-slate-300',
          ].join(' ')}
        >
          <BellRing
            className={`size-3.5 ${isCalling ? 'motion-safe:animate-pulse' : ''}`}
            aria-hidden="true"
          />
          {phaseMeta ? phaseMeta.label : 'Sala de espera'}
        </span>

        {entry?.room && (
          <span className={CHIP}>
            <DoorOpen className="size-4 text-brand-300" aria-hidden="true" />
            {entry.room}
          </span>
        )}

        {entry?.calledAtTime && (
          <span className={CHIP}>
            <Clock3 className="size-4 text-brand-300" aria-hidden="true" />
            Llamado {entry.calledAtTime} hs
          </span>
        )}
      </div>

      {entry ? (
        <div className="relative mt-6 min-w-0">
          <p className="text-xs font-medium tracking-[0.22em] text-brand-300/90 uppercase">
            {isCalling ? 'Pasar a consultorio' : 'Paciente en consultorio'}
          </p>

          <h2
            aria-live="polite"
            aria-atomic="true"
            className="mt-2 text-[clamp(2.25rem,6vw,5.25rem)] leading-[1.02] font-semibold tracking-tight text-white"
          >
            {entry.patientName}
          </h2>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {entry.dentistName && (
              <span className={CHIP}>
                <Stethoscope className="size-4 text-brand-300" aria-hidden="true" />
                {entry.dentistName}
              </span>
            )}
            <span className={CHIP}>
              <UserRound className="size-4 text-brand-300" aria-hidden="true" />
              {entry.appointment.reason}
            </span>
          </div>

          <p className="mt-5 text-sm text-slate-400">
            {isCalling
              ? `Llamado ${callAgeLabel(entry, now)}.`
              : phaseMeta?.caption ?? 'Siendo atendido.'}
            {!entry.room && isCalling && ' Pasá a recepción para que te indiquen el consultorio.'}
          </p>
        </div>
      ) : (
        <div className="relative mt-6">
          <p className="text-xs font-medium tracking-[0.22em] text-brand-300/90 uppercase">
            Bienvenido a AD Clinic
          </p>
          <h2 className="mt-2 text-[clamp(1.85rem,4vw,3.25rem)] leading-tight font-semibold tracking-tight text-white">
            {waitingCount > 0
              ? 'En breve llamamos al próximo paciente'
              : 'Gracias por esperar'}
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-400">
            {waitingCount > 0
              ? `Hay ${waitingCount} ${waitingCount === 1 ? 'paciente' : 'pacientes'} en sala. El nombre del próximo turno aparece en esta pantalla con el consultorio asignado.`
              : 'Cuando recepción llame a un paciente, su nombre y su consultorio aparecen en esta pantalla.'}
          </p>
        </div>
      )}
    </section>
  )
}
