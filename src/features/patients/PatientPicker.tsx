import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { filterPatients } from './filter-patients'
import { patientContactLabel } from './patient-contact'
import type { Patient } from './patient-types'

export type PatientPickerProps = {
  patients: Patient[]
  onSelect: (patient: Patient) => void
  disabled?: boolean
  /** Enfoca el buscador al abrir el modal. */
  autoFocus?: boolean
  /** Prefijo de los ids del campo (para evitar duplicados en la página). */
  idPrefix?: string
  /** Mensaje extra cuando todavía no hay fichas cargadas. */
  emptyListHint?: ReactNode
  maxResults?: number
}

const MAX_RESULTS = 6

const INPUT_CLASS =
  'w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500'

/**
 * Buscador de pacientes ya registrados.
 *
 * Responde en cada tecla (búsqueda en memoria sobre las fichas cargadas) y
 * Enter elige el primer resultado sin enviar el formulario que lo contiene.
 */
export function PatientPicker({
  patients,
  onSelect,
  disabled = false,
  autoFocus = false,
  idPrefix = 'patient-picker',
  emptyListHint,
  maxResults = MAX_RESULTS,
}: PatientPickerProps) {
  const [query, setQuery] = useState('')
  const inputId = `${idPrefix}-search`

  const matches = useMemo(
    () => filterPatients(patients, { query, status: 'all' }).slice(0, maxResults),
    [patients, query, maxResults],
  )

  return (
    <div className="space-y-2">
      <div className="relative">
        <label htmlFor={inputId} className="sr-only">
          Buscar paciente por nombre, documento o teléfono
        </label>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          id={inputId}
          data-autofocus={autoFocus ? true : undefined}
          type="text"
          role="searchbox"
          autoComplete="off"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return

            // Enter elige el primer resultado en lugar de enviar el formulario.
            event.preventDefault()

            const [first] = matches
            if (first) onSelect(first)
          }}
          placeholder="Buscar por nombre, C.I./RUC o teléfono…"
          className={INPUT_CLASS}
        />
      </div>

      <ul className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
        {matches.length === 0 ? (
          <li className="px-3 py-4 text-sm text-slate-500">
            {patients.length > 0
              ? 'No encontramos pacientes con esa búsqueda.'
              : 'Todavía no hay pacientes cargados.'}
            {patients.length === 0 && (
              <>
                {' '}
                <Link to="/pacientes" className="font-medium text-brand-700 underline">
                  Registrá el primero
                </Link>
                .
              </>
            )}
            {emptyListHint}
          </li>
        ) : (
          matches.map((patient) => (
            <li key={patient.id}>
              <button
                type="button"
                onClick={() => onSelect(patient)}
                disabled={disabled}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-brand-50/60 disabled:opacity-60"
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-slate-900">
                    {patient.first_name} {patient.last_name}
                  </span>
                  {patient.status !== 'active' && (
                    <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                      {patient.status}
                    </span>
                  )}
                </span>
                <span className="truncate text-xs text-slate-500">
                  {patientContactLabel(patient) || 'Sin documento ni teléfono'}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
