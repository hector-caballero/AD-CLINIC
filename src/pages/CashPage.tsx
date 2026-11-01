import { useMemo, useState } from 'react'
import { AlertCircle, Loader2, ReceiptText, RefreshCw, SearchX, X } from 'lucide-react'
import { formatPYG } from '../lib/format'
import { BalancesPanel } from '../features/cash/BalancesPanel'
import { CashSummaryCards } from '../features/cash/CashSummaryCards'
import { CashToolbar } from '../features/cash/CashToolbar'
import { MovementsTable } from '../features/cash/MovementsTable'
import { PatientAccountModal } from '../features/cash/PatientAccountModal'
import { RegisterMovementModal } from '../features/cash/RegisterMovementModal'
import { formatMonthLabel } from '../features/cash/cash-dates'
import { countMovementsByType, filterMovements } from '../features/cash/cash-metrics'
import type {
  CashPeriod,
  MovementResult,
  MovementTypeFilter,
  PatientBalance,
} from '../features/cash/cash-types'
import { useCashMovements } from '../features/cash/useCashMovements'
import { useCashOverview } from '../features/cash/useCashOverview'
import { usePatients } from '../features/patients/usePatients'

const PRIMARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400'

const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white/85 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50'

/**
 * Caja y finanzas.
 *
 * - Tarjetas con lo cobrado hoy/en el mes, la deuda pendiente y los
 *   tratamientos realizados.
 * - Historial de `transactions` (cargos, pagos, ajustes y devoluciones) con el
 *   paciente y el tratamiento embebidos por PostgREST.
 * - Modal para cobrar tratamientos del catálogo o registrar un abono libre.
 * - Panel de saldos por paciente (`patient_balances`) y estado de cuenta.
 */
export default function CashPage() {
  const [period, setPeriod] = useState<CashPeriod>('month')
  const [typeFilter, setTypeFilter] = useState<MovementTypeFilter>('all')
  const [query, setQuery] = useState('')
  const [registerState, setRegisterState] = useState<{ patientId?: string } | null>(null)
  const [accountPatientId, setAccountPatientId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { patients, error: patientsError, reload: reloadPatients } = usePatients()
  const overview = useCashOverview()
  const {
    movements,
    range,
    isLoading: isMovementsLoading,
    error: movementsError,
    reload: reloadMovements,
  } = useCashMovements(period)

  const [monthLabel] = useState(() => formatMonthLabel(new Date()))
  const counts = useMemo(() => countMovementsByType(movements), [movements])

  const visibleMovements = useMemo(
    () => filterMovements(movements, { query, type: typeFilter }),
    [movements, query, typeFilter],
  )

  const periodCollected = useMemo(
    () =>
      visibleMovements
        .filter((movement) => movement.type === 'payment' && movement.status === 'paid')
        .reduce((total, movement) => total + movement.amount, 0),
    [visibleMovements],
  )

  const accountBalance: PatientBalance | null = accountPatientId
    ? (overview.balances.find((balance) => balance.patient_id === accountPatientId) ?? null)
    : null

  const hasFilters = query.trim().length > 0 || typeFilter !== 'all'

  function openRegister(patientId?: string) {
    setNotice(null)
    setRegisterState(patientId ? { patientId } : {})
  }

  function openAccount(patientId: string) {
    setNotice(null)
    setAccountPatientId(patientId)
  }

  function handleSaved(result: MovementResult, patientName: string) {
    setRegisterState(null)
    setNotice(
      result.kind === 'charge'
        ? result.collected
          ? `Cobro de ${formatPYG(result.total)} registrado para ${patientName}.`
          : `Cargo de ${formatPYG(result.total)} registrado a cuenta de ${patientName}.`
        : `Abono de ${formatPYG(result.total)} registrado para ${patientName}.`,
    )

    reloadMovements()
    overview.reload()
  }

  function handleChargeFromAccount(patientId: string) {
    setAccountPatientId(null)

    // Si la ficha todavía no está cargada, el modal abre sin preselección.
    openRegister(patients.some((patient) => patient.id === patientId) ? patientId : undefined)
  }

  function clearFilters() {
    setQuery('')
    setTypeFilter('all')
  }

  return (
    <div className="space-y-5">
      <CashSummaryCards
        metrics={overview.metrics}
        isLoading={overview.isLoading}
        monthLabel={monthLabel}
      />

      {overview.error && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            No pudimos cargar el resumen de caja: {overview.error}
          </span>
          <button
            type="button"
            onClick={overview.reload}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white/85 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Reintentar
          </button>
        </div>
      )}

      {patientsError && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>No pudimos cargar los pacientes para el buscador: {patientsError}</span>
          <button
            type="button"
            onClick={reloadPatients}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-white/85 px-2.5 py-1 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Reintentar
          </button>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <section
          aria-label="Historial de movimientos"
          aria-busy={isMovementsLoading}
          className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/85 shadow-card backdrop-blur-md"
        >
          <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
            <CashToolbar
              query={query}
              period={period}
              typeFilter={typeFilter}
              counts={counts}
              rangeLabel={range.label}
              isRefreshing={isMovementsLoading || overview.isLoading}
              onQueryChange={setQuery}
              onPeriodChange={setPeriod}
              onTypeFilterChange={setTypeFilter}
              onRefresh={() => {
                reloadMovements()
                overview.reload()
              }}
              onCreate={() => openRegister()}
            />
          </div>

          {notice && (
            <div
              role="status"
              className="flex items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 sm:px-5"
            >
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                aria-label="Cerrar aviso"
                className="rounded-md p-1 text-emerald-700 transition-colors hover:bg-emerald-100"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {movementsError ? (
            <div role="alert" className="flex flex-col items-center px-6 py-16 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                <AlertCircle className="size-7" aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-sm font-semibold text-slate-900">
                No pudimos cargar el historial
              </h2>
              <p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
                {movementsError}
              </p>
              <button
                type="button"
                onClick={reloadMovements}
                className={`mt-5 ${PRIMARY_BUTTON_CLASS}`}
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                Reintentar
              </button>
            </div>
          ) : isMovementsLoading ? (
            <div
              role="status"
              aria-live="polite"
              className="flex flex-col items-center gap-3 px-6 py-20 text-center"
            >
              <Loader2 className="size-6 animate-spin text-brand-600" aria-hidden="true" />
              <p className="text-sm text-slate-500">Cargando los movimientos…</p>
            </div>
          ) : visibleMovements.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                {hasFilters ? (
                  <SearchX className="size-7" aria-hidden="true" />
                ) : (
                  <ReceiptText className="size-7" aria-hidden="true" />
                )}
              </span>
              <h2 className="mt-4 text-sm font-semibold text-slate-900">
                {hasFilters ? 'Sin resultados para este filtro' : 'Todavía no hay movimientos'}
              </h2>
              <p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
                {hasFilters
                  ? 'Probá con otro paciente, concepto o recibo; también podés limpiar los filtros para ver todo el período.'
                  : 'Registrá el primer cobro de tratamiento o un abono para empezar a llevar la cuenta corriente de la clínica.'}
              </p>
              {hasFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className={`mt-5 ${SECONDARY_BUTTON_CLASS}`}
                >
                  Limpiar filtros
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => openRegister()}
                  className={`mt-5 ${PRIMARY_BUTTON_CLASS}`}
                >
                  Registrar cobro
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500 sm:px-5">
                <span>
                  Mostrando{' '}
                  <span className="font-semibold text-slate-700">{visibleMovements.length}</span>{' '}
                  de {movements.length} movimientos
                </span>
                <span className="tabular-nums">
                  Cobrado en el período:{' '}
                  <span className="font-semibold text-emerald-700">
                    {formatPYG(periodCollected)}
                  </span>
                </span>
              </div>

              <MovementsTable movements={visibleMovements} onOpenAccount={openAccount} />
            </>
          )}
        </section>

        <BalancesPanel
          balances={overview.balances}
          isLoading={overview.isLoading}
          error={overview.error}
          onRetry={overview.reload}
          onOpenAccount={openAccount}
        />
      </div>

      <p className="text-xs leading-relaxed text-slate-400">
        Los importes se guardan en guaraníes. El saldo de cada paciente sale de la vista{' '}
        <span className="font-medium text-slate-500">patient_balances</span> (cargos − ajustes −
        pagos confirmados + devoluciones): un cobro inmediato registra el cargo y el pago, mientras
        que un cargo «a cuenta» queda pendiente hasta que se registre un abono.
      </p>

      {registerState && (
        <RegisterMovementModal
          key={registerState.patientId ?? 'new-movement'}
          patients={patients}
          initialPatientId={registerState.patientId}
          balances={overview.balances}
          onClose={() => setRegisterState(null)}
          onSaved={handleSaved}
        />
      )}

      {accountPatientId && (
        <PatientAccountModal
          key={accountPatientId}
          patientId={accountPatientId}
          initialBalance={accountBalance}
          onClose={() => setAccountPatientId(null)}
          onCharge={handleChargeFromAccount}
        />
      )}
    </div>
  )
}

