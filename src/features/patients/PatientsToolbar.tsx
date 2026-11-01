import { Plus, Search, X } from 'lucide-react'
import type { PatientStatusFilter } from './patient-types'

type PatientCounts = Record<PatientStatusFilter, number>

type PatientsToolbarProps = {
  query: string
  status: PatientStatusFilter
  counts: PatientCounts
  onQueryChange: (value: string) => void
  onStatusChange: (value: PatientStatusFilter) => void
  onCreate: () => void
}

const FILTERS: { value: PatientStatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
]

export function PatientsToolbar({
  query,
  status,
  counts,
  onQueryChange,
  onStatusChange,
  onCreate,
}: PatientsToolbarProps) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative">
          <label htmlFor="patient-search" className="sr-only">
            Buscar pacientes por nombre, documento o teléfono
          </label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            id="patient-search"
            type="text"
            role="searchbox"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Buscar por nombre, C.I./RUC o teléfono…"
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

        <div
          role="group"
          aria-label="Filtrar pacientes por estado"
          className="inline-flex w-fit rounded-xl border border-slate-200 bg-slate-50 p-1"
        >
          {FILTERS.map((filter) => {
            const isActive = status === filter.value

            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => onStatusChange(filter.value)}
                aria-pressed={isActive}
                className={[
                  'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm',
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

      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400"
      >
        <Plus className="size-4" aria-hidden="true" />
        Nuevo paciente
      </button>
    </div>
  )
}
