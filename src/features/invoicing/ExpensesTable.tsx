import { Pencil, Trash2 } from 'lucide-react'
import { formatPYG, formatShortDate } from '../../lib/format'
import { PAYMENT_METHOD_LABELS } from '../cash/cash-types'
import { getStoredIvaTotal } from './invoicing-tax'
import { getExpenseAttributionLabel, type ExpenseInvoice } from './invoicing-types'

type ExpensesTableProps = {
  expenses: ExpenseInvoice[]
  onEdit: (expense: ExpenseInvoice) => void
  onDelete: (expense: ExpenseInvoice) => void
}

const HEAD_CLASS = 'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500'

/**
 * Facturas de gasto (compras del consultorio).
 *
 * A diferencia de las facturas emitidas, un gasto sí se puede corregir o
 * borrar: no tiene numeración fiscal propia ni efectos sobre el correlativo
 * de la SET. La columna «Imputado» dice si el gasto es general de la clínica
 * o de un emisor concreto (útil para repartir costos en modo multi-emisor).
 */
export function ExpensesTable({ expenses, onEdit, onDelete }: ExpensesTableProps) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full divide-y divide-slate-200 text-left">
          <caption className="sr-only">Facturas de gasto registradas en AD Clinic</caption>
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className={HEAD_CLASS}>
                Fecha
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Proveedor
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Comprobante
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Imputado a
              </th>
              <th scope="col" className={`${HEAD_CLASS} text-right`}>
                Total
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white/60">
            {expenses.map((expense) => (
              <tr key={expense.id}>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {formatShortDate(expense.issued_on)}
                </td>

                <td className="px-4 py-3">
                  <p className="max-w-48 truncate text-sm font-medium text-slate-900">
                    {expense.supplier_name}
                  </p>
                  {expense.supplier_ruc && (
                    <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                      RUC {expense.supplier_ruc}
                    </p>
                  )}
                </td>

                <td className="px-4 py-3">
                  <p className="font-mono text-xs text-slate-700">{expense.invoice_number}</p>
                  {expense.timbrado_number && (
                    <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                      Timbrado {expense.timbrado_number}
                    </p>
                  )}
                  {expense.expense_kind && (
                    <p className="mt-0.5 truncate text-[11px] text-slate-400">
                      {expense.expense_kind}
                    </p>
                  )}
                </td>

                <td className="px-4 py-3">
                  <p className="max-w-40 truncate text-sm text-slate-700">
                    {getExpenseAttributionLabel(expense)}
                  </p>
                  {expense.payment_method && (
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {PAYMENT_METHOD_LABELS[expense.payment_method]}
                    </p>
                  )}
                </td>

                <td className="px-4 py-3 text-right">
                  <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-slate-900">
                    {formatPYG(expense.total)}
                  </p>
                  <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                    IVA {formatPYG(getStoredIvaTotal(expense))}
                  </p>
                </td>

                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => onEdit(expense)}
                      aria-label={`Editar el gasto de ${expense.supplier_name}`}
                      title="Editar gasto"
                      className="rounded-lg border border-slate-300 bg-white/85 p-1.5 text-slate-500 transition-colors hover:bg-slate-50 hover:text-brand-700"
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(expense)}
                      aria-label={`Borrar el gasto de ${expense.supplier_name}`}
                      title="Borrar gasto"
                      className="rounded-lg border border-slate-300 bg-white/85 p-1.5 text-slate-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-slate-100 md:hidden">
        {expenses.map((expense) => (
          <li key={expense.id} className="px-4 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-slate-400">{formatShortDate(expense.issued_on)}</p>
                <p className="mt-1 truncate text-sm font-semibold text-slate-900">
                  {expense.supplier_name}
                </p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                  {expense.invoice_number}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {getExpenseAttributionLabel(expense)}
                  {expense.expense_kind ? ` · ${expense.expense_kind}` : ''}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-slate-900">
                  {formatPYG(expense.total)}
                </p>
                <p className="mt-0.5 whitespace-nowrap text-[11px] tabular-nums text-slate-400">
                  IVA {formatPYG(getStoredIvaTotal(expense))}
                </p>
              </div>
            </div>

            <div className="mt-2.5 flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => onEdit(expense)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white/85 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                <Pencil className="size-3.5" aria-hidden="true" />
                Editar
              </button>
              <button
                type="button"
                onClick={() => onDelete(expense)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white/85 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Borrar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
