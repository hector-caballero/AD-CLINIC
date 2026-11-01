import { Wallet } from 'lucide-react'
import { formatPatientDocument, formatPYG, formatShortDate, getInitials } from '../../lib/format'
import { formatMovementDate, formatMovementTime } from './cash-dates'
import { formatSignedAmount, getMovementTimestamp } from './cash-format'
import {
  PAYMENT_METHOD_LABELS,
  TRANSACTION_STATUS_META,
  TRANSACTION_TYPE_META,
  getMovementConcept,
  getMovementPatientName,
  isPendingCharge,
  type CashMovement,
} from './cash-types'

type MovementsTableProps = {
  movements: CashMovement[]
  onOpenAccount: (patientId: string) => void
}

const HEAD_CLASS = 'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500'

function TypeBadge({ type }: { type: CashMovement['type'] }) {
  const meta = TRANSACTION_TYPE_META[type]

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${meta.badge}`}
    >
      {meta.label}
    </span>
  )
}

function StatusBadge({ status }: { status: CashMovement['status'] }) {
  const meta = TRANSACTION_STATUS_META[status] ?? TRANSACTION_STATUS_META.pending

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${meta.badge}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  )
}

function MovementAmount({ movement }: { movement: CashMovement }) {
  const tone = TRANSACTION_TYPE_META[movement.type].amountTone

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className={`whitespace-nowrap text-sm font-semibold tabular-nums ${tone}`}>
        {formatSignedAmount(movement.type, movement.amount)}
      </span>
      {movement.currency !== 'PYG' && (
        <span
          title="Moneda distinta al guaraní"
          className="rounded bg-amber-50 px-1 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200"
        >
          {movement.currency}
        </span>
      )}
    </span>
  )
}


/**
 * Historial de movimientos: tabla en `md+` y tarjetas en móvil.
 *
 * Cada fila resume fecha, paciente, concepto, monto, método y estado; el botón
 * de la última columna abre el estado de cuenta del paciente.
 */
export function MovementsTable({ movements, onOpenAccount }: MovementsTableProps) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full divide-y divide-slate-200 text-left">
          <caption className="sr-only">Movimientos de caja registrados en AD Clinic</caption>
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className={HEAD_CLASS}>
                Fecha
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Paciente
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Concepto
              </th>
              <th scope="col" className={`${HEAD_CLASS} text-right`}>
                Monto
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Método
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Estado
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Estado de cuenta</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {movements.map((movement) => {
              const patientName = getMovementPatientName(movement)
              const timestamp = getMovementTimestamp(movement)
              const item = movement.patient_treatment
              const treatment = item?.treatment
              const notes = movement.notes?.trim()

              return (
                <tr key={movement.id} className="align-top transition-colors hover:bg-slate-50/70">
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="block text-xs font-medium text-slate-700">
                      {formatMovementDate(timestamp)}
                    </span>
                    <span className="block text-xs tabular-nums text-slate-400">
                      {formatMovementTime(timestamp)}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[10px] font-semibold text-brand-700 ring-1 ring-brand-100"
                      >
                        {getInitials(patientName)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{patientName}</p>
                        <p className="truncate text-xs text-slate-500">
                          {formatPatientDocument(
                            movement.patient?.document_type,
                            movement.patient?.document_number,
                          )}
                        </p>
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <TypeBadge type={movement.type} />
                      <span className="text-sm text-slate-800">{getMovementConcept(movement)}</span>
                    </div>
                    {treatment && (
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {treatment.code} · <span className="capitalize">{treatment.category}</span>
                        {item && item.quantity > 1
                          ? ` · ${item.quantity} × ${formatPYG(item.unit_price)}`
                          : ''}
                      </p>
                    )}
                    {notes && (
                      <p className="mt-1 max-w-xs truncate text-xs text-slate-400" title={notes}>
                        {notes}
                      </p>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right">
                    <MovementAmount movement={movement} />
                  </td>

                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {movement.method ? PAYMENT_METHOD_LABELS[movement.method] : '—'}
                  </td>

                  <td className="px-4 py-3">
                    <StatusBadge status={movement.status} />
                    {movement.receipt_number && (
                      <p className="mt-1 text-[11px] text-slate-400">
                        Recibo {movement.receipt_number}
                      </p>
                    )}
                    {isPendingCharge(movement) && movement.due_date && (
                      <p className="mt-1 text-[11px] text-amber-600">
                        Vence {formatShortDate(movement.due_date)}
                      </p>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onOpenAccount(movement.patient_id)}
                      aria-label={`Ver el estado de cuenta de ${patientName}`}
                      title="Estado de cuenta"
                      className="rounded-lg border border-slate-300 bg-white/85 p-1.5 text-slate-500 transition-colors hover:bg-slate-50 hover:text-brand-700"
                    >
                      <Wallet className="size-4" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>



      <ul className="divide-y divide-slate-100 md:hidden">
        {movements.map((movement) => {
          const patientName = getMovementPatientName(movement)
          const timestamp = getMovementTimestamp(movement)

          return (
            <li key={movement.id} className="px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <TypeBadge type={movement.type} />
                    <span className="text-xs text-slate-400">
                      {formatMovementDate(timestamp)} · {formatMovementTime(timestamp)}
                    </span>
                  </div>
                  <p className="mt-1.5 truncate text-sm font-semibold text-slate-900">
                    {getMovementConcept(movement)}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{patientName}</p>
                </div>
                <MovementAmount movement={movement} />
              </div>

              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={movement.status} />
                  <span className="text-xs text-slate-500">
                    {movement.method ? PAYMENT_METHOD_LABELS[movement.method] : 'Sin método'}
                  </span>
                  {movement.receipt_number && (
                    <span className="text-[11px] text-slate-400">· {movement.receipt_number}</span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => onOpenAccount(movement.patient_id)}
                  aria-label={`Ver el estado de cuenta de ${patientName}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white/85 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <Wallet className="size-3.5" aria-hidden="true" />
                  Estado de cuenta
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
