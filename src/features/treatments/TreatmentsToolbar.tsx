import { Plus, Search, X } from 'lucide-react'
import {
  TREATMENT_STATUS_FILTERS,
  type TreatmentCategoryFilter,
  type TreatmentStatusFilter,
} from './treatment-types'

type TreatmentsToolbarProps = {
  query: string
  status: TreatmentStatusFilter
  category: string
  statusCounts: Record<TreatmentStatusFilter, number>
  categoryFilters: TreatmentCategoryFilter[]
  onQueryChange: (value: string) => void
  onStatusChange: (value: TreatmentStatusFilter) => void
  onCategoryChange: (value: string) => void
  onCreate: () => void
}

/**
 * Barra de herramientas del catálogo: búsqueda libre, filtro por estado,
 * filtro por categoría y alta de un tratamiento nuevo.
 */
export function TreatmentsToolbar({
  query,
  status,
  category,
  statusCounts,
  categoryFilters,
  onQueryChange,
  onStatusChange,
  onCategoryChange,
  onCreate,
}: TreatmentsToolbarProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative">
            <label htmlFor="treatment-search" className="sr-only">
              Buscar tratamientos por nombre, código o categoría
            </label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="treatment-search"
              type="text"
              role="searchbox"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Buscar por nombre, código o categoría…"
              autoComplete="off"
              className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-9 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500 sm:w-80"
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
            aria-label="Filtrar tratamientos por estado"
            className="inline-flex w-fit rounded-xl border border-slate-200 bg-slate-50 p-1"
          >
            {TREATMENT_STATUS_FILTERS.map((filter) => {
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
                      ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
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
                    {statusCounts[filter.value]}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
        >
          <Plus className="size-4" aria-hidden="true" />
          Nuevo tratamiento
        </button>
      </div>

      <div
        role="group"
        aria-label="Filtrar tratamientos por categoría"
        className="flex gap-1.5 overflow-x-auto pb-1"
      >
        {categoryFilters.map((filter) => {
          const isActive = category === filter.value

          return (
            <button
              key={filter.value}
              type="button"
              onClick={() => onCategoryChange(filter.value)}
              aria-pressed={isActive}
              className={[
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                isActive
                  ? 'border-brand-300 bg-brand-50 text-brand-800'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
              ].join(' ')}
            >
              {filter.label}
              <span className="text-[10px] font-semibold tabular-nums opacity-70">
                {filter.count}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
