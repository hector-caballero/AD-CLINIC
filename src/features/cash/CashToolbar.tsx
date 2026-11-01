import { HandCoins, RefreshCw, Search, X } from 'lucide-react'
import {
  MOVEMENT_TYPE_FILTERS,
  type CashPeriod,
  type MovementTypeFilter,
} from './cash-types'

type CashToolbarProps = {
  query: string
  period: CashPeriod
  typeFilter: MovementTypeFilter
  counts: Record<MovementTypeFilter, number>
  rangeLabel: string
  isRefreshing?: boolean
  onQueryChange: (value: string) => void
  onPeriodChange: (period: CashPeriod) => void
  onTypeFilterChange: (filter: MovementTypeFilter) => void
  onRefresh: () => void
  onCreate: () => void
}

const PERIODS: { value: CashPeriod; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'month', label: 'Este mes' },
  { value: '30d', label: '30 días' },
  { value: 'all', label: 'Todo' },
]

const SEGMENTED_CLASS = 'inline-flex w-fit rounded-xl border border-slate-200 bg-slate-50 p-1'

export function CashToolbar({
  query,
  period,
  typeFilter,
  counts,
  rangeLabel,
  isRefreshing = false,
  onQueryChange,
  onPeriodChange,
  onTypeFilterChange,
  onRefresh,
  onCreate,
}: CashToolbarProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative">
            <label htmlFor="cash-search" className="sr-only">
              Buscar movimientos por paciente, concepto o recibo
            </label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="cash-search"
              type="text"
              role="searchbox"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Buscar por paciente, concepto o recibo…"
              autoComplete="off"
              className="w-full rounded-xl border border-slate-300 bg-white/85 py-2.5 pl-9 pr-9 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500 sm:w-80"
            />
            {query && (
              <button
                type="button"
                onClick={() => onQueryChange('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>

          <div role="group" aria-label="Período del historial" className={SEGMENTED_CLASS}>
            {PERIODS.map((option) => {
              const isActive = period === option.value

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onPeriodChange(option.value)}
                  aria-pressed={isActive}
                  className={[
                    'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm',
                    isActive
                      ? 'bg-white/85 text-slate-900 shadow-sm ring-1 ring-slate-200'
                      : 'text-slate-500 hover:text-slate-800',
                  ].join(' ')}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Actualizar el historial y los saldos"
            title="Actualizar"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white/85 p-2.5 text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <RefreshCw
              className={`size-4 ${isRefreshing ? 'animate-spin text-brand-600' : ''}`}
              aria-hidden="true"
            />
          </button>

          <button
            type="button"
            onClick={onCreate}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400"
          >
            <HandCoins className="size-4" aria-hidden="true" />
            Registrar cobro
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-slate-500">
        <span className="text-sm font-semibold text-slate-900">{rangeLabel}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{counts.all} movimientos</span>

        <div
          role="group"
          aria-label="Filtrar movimientos por tipo"
          className="ml-1 inline-flex w-fit rounded-xl border border-slate-200 bg-slate-50 p-1"
        >
          {MOVEMENT_TYPE_FILTERS.map((filter) => {
            const isActive = typeFilter === filter.value

            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => onTypeFilterChange(filter.value)}
                aria-pressed={isActive}
                className={[
                  'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-white/85 text-slate-900 shadow-sm ring-1 ring-slate-200'
                    : 'text-slate-500 hover:text-slate-800',
                ].join(' ')}
              >
                {filter.label}
                <span
                  className={[
                    'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                    isActive ? 'bg-brand-50 text-brand-700' : 'bg-slate-200/70 text-slate-500',
                  ].join(' ')}
                >
                  {counts[filter.value]}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
