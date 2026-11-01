import { Search, UserPlus, X } from 'lucide-react'
import {
  TEAM_ROLE_FILTERS,
  type TeamRoleFilter,
} from './team-types'

type TeamToolbarProps = {
  query: string
  role: TeamRoleFilter
  roleCounts: Record<TeamRoleFilter, number>
  onQueryChange: (value: string) => void
  onRoleChange: (value: TeamRoleFilter) => void
  onCreate: () => void
}

/**
 * Barra de herramientas del equipo: búsqueda por nombre o correo, filtro por
 * rol y alta de un usuario nuevo (vía Edge Function `team-admin`).
 */
export function TeamToolbar({
  query,
  role,
  roleCounts,
  onQueryChange,
  onRoleChange,
  onCreate,
}: TeamToolbarProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative">
          <label htmlFor="team-search" className="sr-only">
            Buscar usuarios por nombre o correo
          </label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            id="team-search"
            type="text"
            role="searchbox"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Buscar por nombre o correo…"
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

        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400"
        >
          <UserPlus className="size-4" aria-hidden="true" />
          Nuevo usuario
        </button>
      </div>

      <div
        role="group"
        aria-label="Filtrar el equipo por rol"
        className="flex gap-1.5 overflow-x-auto pb-1"
      >
        {TEAM_ROLE_FILTERS.map((filter) => {
          const isActive = role === filter.value

          return (
            <button
              key={filter.value}
              type="button"
              onClick={() => onRoleChange(filter.value)}
              aria-pressed={isActive}
              className={[
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                isActive
                  ? 'border-brand-300 bg-brand-50 text-brand-800'
                  : 'border-slate-200/80 bg-white/85 text-slate-600 hover:border-slate-300 hover:text-slate-900',
              ].join(' ')}
            >
              {filter.label}
              <span className="text-[10px] font-semibold tabular-nums opacity-70">
                {roleCounts[filter.value]}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
