import {
  AlertCircle,
  BadgeCheck,
  Banknote,
  CircleCheck,
  ClipboardList,
  FileText,
  Loader2,
  Receipt,
  RefreshCw,
  RotateCcw,
  Trash,
} from 'lucide-react'
import { formatPYG } from '../../lib/format'
import {
  ITEM_STATUS_META,
  STATUS_ORDER,
  computeOdontogramTotals,
  getChargeableItems,
  getItemAmount,
  getItemLabel,
  getSurfaceLabel,
  isBilledItem,
  sortOdontogramItems,
  type OdontogramItem,
  type OdontogramItemStatus,
} from './odontogram-types'

const ACTION_CLASS =
  'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-wait disabled:opacity-60'

type BudgetItemRowProps = {
  item: OdontogramItem
  isBusy: boolean
  readOnly: boolean
  onChangeStatus: (item: OdontogramItem, status: OdontogramItemStatus) => void
  onRemove: (item: OdontogramItem) => void
}

/** Una línea del plan: pieza, cara, procedimiento y acciones de estado. */
function BudgetItemRow({
  item,
  isBusy,
  readOnly,
  onChangeStatus,
  onRemove,
}: BudgetItemRowProps) {
  const meta = ITEM_STATUS_META[item.status]
  const isAbsent = item.status === 'absent'
  const isBilled = isBilledItem(item)

  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
              {item.tooth_number}
            </span>
            <span className="truncate text-sm font-medium text-slate-900">
              {getSurfaceLabel(item.surface)}
            </span>
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${meta.badge}`}
            >
              <span className={`size-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
              {meta.label}
            </span>
            {isBilled && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 ring-1 ring-teal-200">
                <Receipt className="size-2.5" aria-hidden="true" />
                En caja
              </span>
            )}
          </div>

          <p className="mt-1 truncate text-xs text-slate-600">
            {item.treatment?.name ?? 'Pieza ausente / extraída'}
          </p>

          {!isAbsent && (
            <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
              {item.treatment?.code ? `${item.treatment.code} · ` : ''}
              {item.quantity} × {formatPYG(item.unit_price)}
            </p>
          )}
        </div>

        <p
          className={[
            'shrink-0 text-sm font-semibold tabular-nums',
            isAbsent ? 'text-slate-400' : meta.tone,
          ].join(' ')}
        >
          {isAbsent ? '—' : formatPYG(item.total_price)}
        </p>
      </div>

      {!readOnly && !isBilled && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {item.status !== 'completed' && !isAbsent && (
            <button
              type="button"
              onClick={() => onChangeStatus(item, 'completed')}
              disabled={isBusy}
              title="Marcar como realizado"
              className={`${ACTION_CLASS} border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100`}
            >
              {isBusy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <CircleCheck className="size-3.5" aria-hidden="true" />
              )}
              Realizado
            </button>
          )}

          {!isAbsent && item.status !== 'budgeted' && (
            <button
              type="button"
              onClick={() => onChangeStatus(item, 'budgeted')}
              disabled={isBusy}
              title="Volver a presupuestar"
              className={`${ACTION_CLASS} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
            >
              <BadgeCheck className="size-3.5" aria-hidden="true" />
              Presupuestar
            </button>
          )}

          {!isAbsent && item.status !== 'pending' && (
            <button
              type="button"
              onClick={() => onChangeStatus(item, 'pending')}
              disabled={isBusy}
              title="Marcar como patología pendiente"
              className={`${ACTION_CLASS} border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Pendiente
            </button>
          )}

          <button
            type="button"
            onClick={() => onRemove(item)}
            disabled={isBusy}
            title="Quitar del plan"
            aria-label={`Quitar ${getItemLabel(item)}`}
            className={`${ACTION_CLASS} ml-auto border-slate-200/80 bg-white/85 text-slate-500 hover:bg-slate-50 hover:text-red-600`}
          >
            <Trash className="size-3.5" aria-hidden="true" />
            Quitar
          </button>
        </div>
      )}

      {isBilled && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-teal-700">
          <Receipt className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Cobrado en caja: para cambiarlo, ajustá el movimiento desde Caja.
        </p>
      )}
    </li>
  )
}

type StatusMetricProps = {
  status: OdontogramItemStatus
  amount: number
  count: number
}

function StatusMetric({ status, amount, count }: StatusMetricProps) {
  const meta = ITEM_STATUS_META[status]

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-2.5 py-2">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        <span className={`size-2 rounded-full ${meta.dot}`} aria-hidden="true" />
        {meta.shortLabel}
      </p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-slate-900">{formatPYG(amount)}</p>
      <p className="text-[11px] text-slate-500">
        {count} {count === 1 ? 'ítem' : 'ítems'}
      </p>
    </div>
  )
}

export type TreatmentBudgetPanelProps = {
  patientName: string
  dentition: 'permanent' | 'temporary'
  items: OdontogramItem[]
  isLoading: boolean
  error: string | null
  readOnly: boolean
  /** Ítem con una actualización en curso (deshabilita sus acciones). */
  busyItemId: string | null
  onRetry: () => void
  onChangeStatus: (item: OdontogramItem, status: OdontogramItemStatus) => void
  onRemove: (item: OdontogramItem) => void
  /** Abre el modal de «Cobrar este plan». */
  onChargePlan: () => void
  /** Abre la emisión de factura con el importe del plan sin cobrar. */
  onInvoicePlan: () => void
}

/**
 * Presupuesto en tiempo real: total en guaraníes, subtotales por estado y el
 * desglose pieza / cara / procedimiento. Cada línea permite pasar de pendiente
 * a presupuestado o realizado, o quitarla del plan.
 */
export function TreatmentBudgetPanel({
  patientName,
  dentition,
  items,
  isLoading,
  error,
  readOnly,
  busyItemId,
  onRetry,
  onChangeStatus,
  onRemove,
  onChargePlan,
  onInvoicePlan,
}: TreatmentBudgetPanelProps) {
  const sorted = sortOdontogramItems(items)
  const totals = computeOdontogramTotals(sorted)
  const chargeable = getChargeableItems(sorted)
  const chargeableTotal = chargeable.reduce((sum, item) => sum + getItemAmount(item), 0)
  const billedCount = sorted.filter(isBilledItem).length
  const groups = STATUS_ORDER.map((status) => ({
    status,
    items: sorted.filter((item) => item.status === status),
  })).filter((group) => group.items.length > 0)

  const subtotals: Record<OdontogramItemStatus, number> = {
    pending: totals.pending,
    budgeted: totals.budgeted,
    completed: totals.completed,
    absent: 0,
  }

  const counts: Record<OdontogramItemStatus, number> = {
    pending: 0,
    budgeted: 0,
    completed: 0,
    absent: totals.absentTeeth,
  }

  for (const group of groups) counts[group.status] = group.items.length

  const dentitionLabel = dentition === 'permanent' ? 'Dentición permanente' : 'Dentición temporal'

  return (
    <aside className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/85 shadow-card backdrop-blur-md">
      <header className="border-b border-slate-200/70 px-4 py-4 sm:px-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold tracking-[0.18em] text-bronze-500 uppercase">
            Plan de tratamiento
          </p>
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-700 ring-1 ring-brand-100">
            Presupuesto
          </span>
        </div>

        <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
          {formatPYG(totals.plan)}
        </p>

        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          {patientName} · {dentitionLabel} · {totals.items}{' '}
          {totals.items === 1 ? 'procedimiento' : 'procedimientos'}
          {totals.absentTeeth > 0 &&
            ` · ${totals.absentTeeth} ${
              totals.absentTeeth === 1 ? 'pieza ausente' : 'piezas ausentes'
            }`}
        </p>
      </header>

      <div className="grid grid-cols-3 gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
        <StatusMetric status="pending" amount={totals.pending} count={counts.pending} />
        <StatusMetric status="budgeted" amount={totals.budgeted} count={counts.budgeted} />
        <StatusMetric status="completed" amount={totals.completed} count={counts.completed} />
      </div>

      {!readOnly && totals.items > 0 && (
        <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
          {chargeable.length > 0 ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={onChargePlan}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-3 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400"
                >
                  <Banknote className="size-4" aria-hidden="true" />
                  Cobrar este plan
                </button>
                <button
                  type="button"
                  onClick={onInvoicePlan}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white/85 px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                >
                  <FileText className="size-4" aria-hidden="true" />
                  Facturar
                </button>
              </div>
              <p className="mt-1.5 text-center text-[11px] text-slate-500">
                {chargeable.length} {chargeable.length === 1 ? 'línea' : 'líneas'} sin cobrar ·{' '}
                {formatPYG(chargeableTotal)}
              </p>
            </>
          ) : billedCount > 0 ? (
            <p className="rounded-xl bg-teal-50 px-3 py-2 text-center text-[11px] font-medium text-teal-700 ring-1 ring-teal-200">
              Todo el plan está cobrado en caja.
            </p>
          ) : null}
        </div>
      )}

      <div className="min-h-0 flex-1 sm:max-h-[32rem] sm:overflow-y-auto">
        {isLoading ? (
          <p className="flex items-center gap-2 px-4 py-8 text-sm text-slate-500 sm:px-5">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Cargando el plan de tratamiento…
          </p>
        ) : error ? (
          <div className="px-4 py-6 sm:px-5">
            <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white/85 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Reintentar
            </button>
          </div>
        ) : groups.length === 0 ? (
          <div className="px-4 py-10 text-center sm:px-5">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <ClipboardList className="size-6" aria-hidden="true" />
            </span>
            <h3 className="mt-3 text-sm font-semibold text-slate-900">Presupuesto vacío</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              {readOnly
                ? 'El odontólogo todavía no registró procedimientos en este odontograma.'
                : 'Elegí una pieza o una cara del odontograma y agregá el primer procedimiento del catálogo.'}
            </p>
          </div>
        ) : (
          groups.map((group) => {
            const meta = ITEM_STATUS_META[group.status]

            return (
              <section key={group.status} aria-label={meta.label}>
                <h3 className="sticky top-0 z-10 flex items-center justify-between gap-2 border-y border-slate-100 bg-slate-50/95 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 backdrop-blur sm:px-5">
                  <span className="flex items-center gap-1.5">
                    <span className={`size-2 rounded-full ${meta.dot}`} aria-hidden="true" />
                    {meta.label}
                  </span>
                  <span className="tabular-nums">
                    {group.items.length} · {formatPYG(subtotals[group.status])}
                  </span>
                </h3>

                <ul className="divide-y divide-slate-100">
                  {group.items.map((item) => (
                    <BudgetItemRow
                      key={item.id}
                      item={item}
                      isBusy={busyItemId === item.id}
                      readOnly={readOnly}
                      onChangeStatus={onChangeStatus}
                      onRemove={onRemove}
                    />
                  ))}
                </ul>
              </section>
            )
          })
        )}
      </div>

      <footer className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-[11px] leading-relaxed text-slate-500 sm:px-5">
        El total suma los procedimientos pendientes, presupuestados y realizados; las piezas
        ausentes no agregan importe. Cada precio queda congelado en guaraníes al guardar la línea.
        Las líneas cobradas quedan enlazadas a su movimiento de caja.
      </footer>
    </aside>
  )
}
