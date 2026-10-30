import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import type { AppointmentView } from './appointment-types'

type AgendaSummary = {
  total: number
  pending: number
  completed: number
  cancelled: number
}

type AgendaToolbarProps = {
  view: AppointmentView
  /** Fecha ancla (`2026-10-29`). */
  anchor: string
  rangeLabel: string
  summary: AgendaSummary
  onViewChange: (view: AppointmentView) => void
  onAnchorChange: (dateKey: string) => void
  onPrevious: () => void
  onNext: () => void
  onToday: () => void
  onCreate: () => void
}

const VIEWS: { value: AppointmentView; label: string }[] = [
  { value: 'day', label: 'Hoy' },
  { value: 'week', label: 'Próximos 7 días' },
]

const NAV_BUTTON =
  'inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-2.5 py-2 text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900'

export function AgendaToolbar({
  view,
  anchor,
  rangeLabel,
  summary,
  onViewChange,
  onAnchorChange,
  onPrevious,
  onNext,
  onToday,
  onCreate,
}: AgendaToolbarProps) {
  const stepLabel = view === 'week' ? 'la semana' : 'el día'

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Vista de la agenda"
            className="inline-flex w-fit rounded-xl border border-slate-200 bg-slate-50 p-1"
          >
            {VIEWS.map((option) => {
              const isActive = view === option.value

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onViewChange(option.value)}
                  aria-pressed={isActive}
                  className={[
                    'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm',
                    isActive
                      ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                      : 'text-slate-500 hover:text-slate-800',
                  ].join(' ')}
                >
                  {option.label}
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onPrevious}
              aria-label={`Ir a ${stepLabel} anterior`}
              className={NAV_BUTTON}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onToday}
              aria-label="Volver al día de hoy"
              className={`${NAV_BUTTON} gap-1.5 px-3 text-xs font-medium`}
            >
              <CalendarDays className="size-4" aria-hidden="true" />
              Ir a hoy
            </button>
            <button
              type="button"
              onClick={onNext}
              aria-label={`Ir a ${stepLabel} siguiente`}
              className={NAV_BUTTON}
            >
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div>
            <label htmlFor="agenda-date" className="sr-only">
              Ir a una fecha de la agenda
            </label>
            <input
              id="agenda-date"
              type="date"
              value={anchor}
              onChange={(event) => {
                if (event.target.value) onAnchorChange(event.target.value)
              }}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors focus:border-brand-500"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
        >
          <Plus className="size-4" aria-hidden="true" />
          Nueva cita
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        <span className="text-sm font-semibold text-slate-900">{rangeLabel}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{summary.total} citas</span>
        {summary.pending > 0 && (
          <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700 ring-1 ring-sky-200">
            {summary.pending} por atender
          </span>
        )}
        {summary.completed > 0 && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600 ring-1 ring-slate-200">
            {summary.completed} atendidas
          </span>
        )}
        {summary.cancelled > 0 && (
          <span className="rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700 ring-1 ring-rose-200">
            {summary.cancelled} canceladas o no asistió
          </span>
        )}
      </div>
    </div>
  )
}
