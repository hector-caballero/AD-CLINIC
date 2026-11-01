import { Banknote, Stethoscope, TrendingUp, Wallet } from 'lucide-react'
import { formatPYG } from '../../lib/format'
import type { CashMetrics } from './cash-metrics'

type CashSummaryCardsProps = {
  /** `null` mientras llega la primera respuesta. */
  metrics: CashMetrics | null
  isLoading: boolean
  monthLabel: string
}

const CARD_CLASS = 'rounded-2xl border border-slate-200/80 bg-white/85 p-5 shadow-card backdrop-blur-md'

function SkeletonValue() {
  return <span className="mt-3 block h-8 w-32 animate-pulse rounded-lg bg-slate-100" />
}

/**
 * Tarjetas de balance general: lo cobrado (hoy y en el mes), la deuda pendiente
 * de los pacientes y los tratamientos realizados.
 */
export function CashSummaryCards({ metrics, isLoading, monthLabel }: CashSummaryCardsProps) {
  const isPending = metrics === null

  return (
    <section
      aria-label="Balance general de la caja"
      aria-busy={isLoading}
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      <article className={CARD_CLASS}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-slate-500">Cobrado hoy</p>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <Banknote className="size-4.5" aria-hidden="true" />
          </span>
        </div>
        {isPending ? (
          <SkeletonValue />
        ) : (
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
            {formatPYG(metrics.collectedToday)}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-400">
          {isPending
            ? 'Pagos confirmados de hoy'
            : `${metrics.paymentsToday} ${metrics.paymentsToday === 1 ? 'cobro' : 'cobros'} confirmados`}
        </p>
      </article>

      <article className={CARD_CLASS}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-slate-500">Cobrado este mes</p>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <TrendingUp className="size-4.5" aria-hidden="true" />
          </span>
        </div>
        {isPending ? (
          <SkeletonValue />
        ) : (
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
            {formatPYG(metrics.collectedMonth)}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-400">
          {isPending ? monthLabel : `${metrics.paymentsMonth} pagos · ${monthLabel}`}
        </p>
      </article>

      <article className={CARD_CLASS}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-slate-500">Saldo pendiente</p>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Wallet className="size-4.5" aria-hidden="true" />
          </span>
        </div>
        {isPending ? (
          <SkeletonValue />
        ) : (
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
            {formatPYG(metrics.pendingTotal)}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-400">
          {isPending
            ? 'Cuentas por cobrar'
            : metrics.debtors === 0
              ? 'Todos los pacientes al día'
              : `${metrics.debtors} ${metrics.debtors === 1 ? 'paciente con deuda' : 'pacientes con deuda'}`}
        </p>
      </article>

      <article className={CARD_CLASS}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-slate-500">Tratamientos realizados</p>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <Stethoscope className="size-4.5" aria-hidden="true" />
          </span>
        </div>
        {isPending ? (
          <SkeletonValue />
        ) : (
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">
            {metrics.treatmentsTotal.toLocaleString('es-PY')}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-400">
          {isPending
            ? 'Tratamientos con estado realizado'
            : `${metrics.treatmentsMonth} en ${monthLabel.toLowerCase()}`}
        </p>
      </article>
    </section>
  )
}
