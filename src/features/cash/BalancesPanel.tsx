import { useMemo, useState } from 'react'
import { Search, Wallet } from 'lucide-react'
import { formatPhonePY, formatPYG } from '../../lib/format'
import { BALANCE_STATE_META, getBalanceState } from './cash-format'
import { filterBalances, summarizeBalances } from './cash-metrics'
import type { PatientBalance } from './cash-types'

type BalancesPanelProps = {
  balances: PatientBalance[]
  isLoading: boolean
  error: string | null
  onRetry: () => void
  onOpenAccount: (patientId: string) => void
}

type BalanceFilter = 'debtors' | 'all'

const FILTERS: { value: BalanceFilter; label: string }[] = [
  { value: 'debtors', label: 'Con deuda' },
  { value: 'all', label: 'Todos' },
]

/**
 * Panel rápido de estado de cuenta por paciente.
 *
 * Usa la vista `patient_balances` (saldo ya calculado en Postgres): al tocar un
 * paciente se abre su historial completo con los totales de cargos y pagos.
 */
export function BalancesPanel({
  balances,
  isLoading,
  error,
  onRetry,
  onOpenAccount,
}: BalancesPanelProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<BalanceFilter>('debtors')

  const summary = useMemo(() => summarizeBalances(balances), [balances])

  const visibleBalances = useMemo(
    () => filterBalances(balances, { query, onlyDebtors: filter === 'debtors' }),
    [balances, query, filter],
  )

  return (
    <section
      aria-label="Saldos por paciente"
      className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <header className="border-b border-slate-200 px-4 py-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Wallet className="size-4 text-brand-600" aria-hidden="true" />
            Saldos por paciente
          </h2>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
            {summary.debtors} con deuda
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          Total por cobrar:{' '}
          <span className="font-semibold text-slate-700">{formatPYG(summary.pending)}</span>
          {summary.credit > 0 && ` · ${formatPYG(summary.credit)} a favor`}
        </p>

        <div className="mt-3 space-y-2">
          <div className="relative">
            <label htmlFor="balances-search" className="sr-only">
              Buscar paciente en los saldos
            </label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              id="balances-search"
              type="text"
              role="searchbox"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar paciente o teléfono…"
              autoComplete="off"
              className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500"
            />
          </div>

          <div
            role="group"
            aria-label="Filtrar saldos"
            className="inline-flex w-fit rounded-xl border border-slate-200 bg-slate-50 p-1"
          >
            {FILTERS.map((option) => {
              const isActive = filter === option.value

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFilter(option.value)}
                  aria-pressed={isActive}
                  className={[
                    'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
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
        </div>
      </header>

      <div className="max-h-[520px] min-h-32 flex-1 overflow-y-auto">
        {error ? (
          <div className="px-4 py-6 text-center">
            <p className="text-sm leading-relaxed text-slate-500">{error}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
            >
              Reintentar
            </button>
          </div>
        ) : isLoading ? (
          <ul className="divide-y divide-slate-100" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <li key={index} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="space-y-1.5">
                  <span className="block h-3.5 w-32 animate-pulse rounded bg-slate-100" />
                  <span className="block h-3 w-24 animate-pulse rounded bg-slate-100" />
                </div>
                <span className="block h-4 w-20 animate-pulse rounded bg-slate-100" />
              </li>
            ))}
          </ul>
        ) : visibleBalances.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm leading-relaxed text-slate-500">
            {balances.length === 0
              ? 'Todavía no hay pacientes para calcular saldos.'
              : filter === 'debtors' && !query
                ? 'No hay saldos pendientes: todos los pacientes están al día.'
                : 'No encontramos saldos con esa búsqueda.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visibleBalances.map((balance) => {
              const state = getBalanceState(balance.balance)
              const meta = BALANCE_STATE_META[state]
              const fullName = `${balance.first_name} ${balance.last_name}`
                .replace(/\s+/g, ' ')
                .trim()

              return (
                <li key={balance.patient_id}>
                  <button
                    type="button"
                    onClick={() => onOpenAccount(balance.patient_id)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-brand-50/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900">{fullName}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {formatPhonePY(balance.phone) || 'Sin teléfono'}
                      </p>
                      <span
                        className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${meta.badge}`}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`text-sm font-semibold tabular-nums ${meta.amount}`}>
                        {formatPYG(Math.abs(balance.balance))}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400">Ver cuenta</p>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
