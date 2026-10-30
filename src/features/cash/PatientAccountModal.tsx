import { AlertCircle, HandCoins, Loader2, RefreshCw } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { formatPhonePY, formatPYG } from '../../lib/format'
import { formatMovementDate, formatMovementTime } from './cash-dates'
import { BALANCE_STATE_META, formatSignedAmount, getBalanceState } from './cash-format'
import {
  TRANSACTION_STATUS_META,
  TRANSACTION_TYPE_META,
  getMovementConcept,
  type PatientBalance,
} from './cash-types'
import { usePatientAccount } from './usePatientAccount'

type PatientAccountModalProps = {
  patientId: string
  /** Saldo de la vista que ya tiene la pantalla (se muestra mientras carga). */
  initialBalance: PatientBalance | null
  onClose: () => void
  onCharge: (patientId: string) => void
}

/**
 * Estado de cuenta individual: saldo de `patient_balances`, totales de cargos /
 * pagos / ajustes y el historial completo del paciente.
 */
export function PatientAccountModal({
  patientId,
  initialBalance,
  onClose,
  onCharge,
}: PatientAccountModalProps) {
  const { balance, movements, isLoading, error, reload } = usePatientAccount(
    patientId,
    initialBalance,
  )

  const state = getBalanceState(balance?.balance ?? 0)
  const meta = BALANCE_STATE_META[state]
  const fullName = balance
    ? `${balance.first_name} ${balance.last_name}`.replace(/\s+/g, ' ').trim()
    : 'Paciente'

  return (
    <Modal
      title="Estado de cuenta"
      description={fullName}
      size="lg"
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={() => onCharge(patientId)}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            <HandCoins className="size-4" aria-hidden="true" />
            Registrar cobro
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex flex-col items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-200"
          >
            <span className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {error}
            </span>
            <button
              type="button"
              onClick={reload}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Reintentar
            </button>
          </div>
        )}

        <section
          aria-label="Saldo del paciente"
          className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Saldo {meta.label}
              </p>
              <p
                className={`mt-1 text-3xl font-semibold tracking-tight tabular-nums ${meta.amount}`}
              >
                {formatPYG(Math.abs(balance?.balance ?? 0))}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {state === 'debt'
                  ? 'Pendiente de cobro'
                  : state === 'credit'
                    ? 'Crédito a favor del paciente'
                    : 'Sin deuda pendiente'}
              </p>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${meta.badge}`}
            >
              {meta.label}
            </span>
          </div>

          {balance?.phone && (
            <p className="mt-2 text-sm text-slate-600">{formatPhonePY(balance.phone)}</p>
          )}

          {isLoading && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Actualizando el estado de cuenta…
            </p>
          )}
        </section>

        <section aria-label="Totales de la cuenta">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Totales históricos
          </h3>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            {[
              { label: 'Cargos', value: balance?.total_charges ?? 0 },
              { label: 'Pagos confirmados', value: balance?.total_payments ?? 0 },
              { label: 'Ajustes', value: balance?.total_adjustments ?? 0 },
              { label: 'Devoluciones', value: balance?.total_refunds ?? 0 },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2"
              >
                <dt className="text-xs text-slate-500">{item.label}</dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">
                  {formatPYG(item.value)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-slate-500">
            Último pago:{' '}
            <span className="font-medium text-slate-700">
              {balance?.last_payment_at
                ? formatMovementDate(balance.last_payment_at)
                : 'Sin pagos registrados'}
            </span>
          </p>
        </section>


        <section aria-label="Historial del paciente">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Movimientos ({movements.length})
            </h3>
            {isLoading && <span className="text-[11px] text-slate-400">Cargando…</span>}
          </div>

          {movements.length === 0 ? (
            <p className="mt-2 rounded-xl border border-slate-200 px-3 py-6 text-center text-sm text-slate-500">
              {isLoading
                ? 'Cargando los movimientos del paciente…'
                : 'Todavía no hay movimientos registrados para este paciente.'}
            </p>
          ) : (
            <ul className="mt-2 max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
              {movements.map((movement) => {
                const timestamp = movement.paid_at ?? movement.created_at
                const status = TRANSACTION_STATUS_META[movement.status]
                const typeMeta = TRANSACTION_TYPE_META[movement.type]

                return (
                  <li key={movement.id} className="px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-1.5 text-sm text-slate-900">
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${typeMeta.badge}`}
                          >
                            {typeMeta.label}
                          </span>
                          <span className="truncate">{getMovementConcept(movement)}</span>
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {formatMovementDate(timestamp)} · {formatMovementTime(timestamp)}
                          {movement.receipt_number ? ` · ${movement.receipt_number}` : ''}
                        </p>
                      </div>
                      <span className={`shrink-0 text-sm font-semibold tabular-nums ${typeMeta.amountTone}`}>
                        {formatSignedAmount(movement.type, movement.amount)}
                      </span>
                    </div>
                    <span
                      className={`mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${status.badge}`}
                    >
                      {status.label}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  )
}

