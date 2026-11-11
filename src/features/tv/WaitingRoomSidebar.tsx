import { CalendarCheck2, DoorOpen, Hourglass, Stethoscope } from 'lucide-react'
import { formatAppointmentTime } from '../appointments/appointment-dates'
import { TV_WAITING_LIMIT, type WaitingRoomEntry } from './tv-types'

type WaitingRoomSidebarProps = {
  waiting: WaitingRoomEntry[]
  /** Llamados hace rato: ya están en el consultorio. */
  inProgress: WaitingRoomEntry[]
  /** Últimos atendidos del día. */
  attended: WaitingRoomEntry[]
}

const PANEL =
  'rounded-3xl border border-white/10 bg-white/[0.03] p-5 shadow-[0_30px_80px_-50px_rgba(0,0,0,0.9)]'

const PANEL_TITLE =
  'flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-brand-300/90 uppercase'

function RoomMeta({ entry }: { entry: WaitingRoomEntry }) {
  if (!entry.room && !entry.dentistName) return null

  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
      {entry.dentistName && (
        <span className="inline-flex items-center gap-1">
          <Stethoscope className="size-3 text-brand-300/80" aria-hidden="true" />
          {entry.dentistName}
        </span>
      )}
      {entry.room && (
        <span className="inline-flex items-center gap-1">
          <DoorOpen className="size-3 text-brand-300/80" aria-hidden="true" />
          {entry.room}
        </span>
      )}
    </p>
  )
}

/** Panel lateral: próximos en espera, en consultorio y últimos atendidos. */
export function WaitingRoomSidebar({ waiting, inProgress, attended }: WaitingRoomSidebarProps) {
  const visibleWaiting = waiting.slice(0, TV_WAITING_LIMIT)
  const hiddenWaiting = waiting.length - visibleWaiting.length

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <section aria-label="Próximos en espera" className={`${PANEL} min-h-0 flex-1`}>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className={PANEL_TITLE}>
            <Hourglass className="size-3.5" aria-hidden="true" />
            En espera
          </h2>
          <span className="text-sm font-semibold tabular-nums text-slate-300">
            {waiting.length}
          </span>
        </div>

        {waiting.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">Nadie esperando en este momento.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {visibleWaiting.map((entry, index) => (
              <li
                key={entry.appointment.id}
                className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-ink-950/40 px-3 py-2.5"
              >
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-xs font-semibold tabular-nums text-brand-200">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium text-white">{entry.patientName}</p>
                  <RoomMeta entry={entry} />
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold tabular-nums text-slate-200">
                    {formatAppointmentTime(entry.appointment.starts_at)}
                  </p>
                  <p className="text-[11px] tabular-nums text-slate-500">
                    {entry.minutesWaiting} min
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}

        {hiddenWaiting > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            y {hiddenWaiting} {hiddenWaiting === 1 ? 'paciente más' : 'pacientes más'} en sala.
          </p>
        )}

        {inProgress.length > 0 && (
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/[0.06] pt-3 text-xs text-slate-400">
            <Stethoscope className="size-3.5 text-brand-300/80" aria-hidden="true" />
            En consultorio:
            <span className="text-slate-200">
              {inProgress.map((entry) => entry.patientName).join(' · ')}
            </span>
          </p>
        )}
      </section>

      <section aria-label="Últimos turnos atendidos" className={PANEL}>
        <h2 className={PANEL_TITLE}>
          <CalendarCheck2 className="size-3.5" aria-hidden="true" />
          Últimos atendidos
        </h2>

        {attended.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">Todavía no hay turnos atendidos hoy.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {attended.map((entry) => (
              <li
                key={entry.appointment.id}
                className="flex items-baseline justify-between gap-3 text-sm"
              >
                <span className="truncate text-slate-300">{entry.patientName}</span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  {formatAppointmentTime(entry.appointment.completed_at ?? entry.appointment.ends_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
