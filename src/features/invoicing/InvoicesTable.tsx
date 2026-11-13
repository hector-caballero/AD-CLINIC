import { Ban } from 'lucide-react'
import { formatPYG, formatShortDate } from '../../lib/format'
import { getStoredIvaTotal } from './invoicing-tax'
import {
  INVOICE_STATUS_META,
  VAT_RATE_LABELS,
  getInvoiceCustomerDocument,
  getIssuerName,
  type Invoice,
} from './invoicing-types'

type InvoicesTableProps = {
  invoices: Invoice[]
  onCancel: (invoice: Invoice) => void
}

const HEAD_CLASS = 'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500'

/** `2026-11-11T13:45:00+00:00` → `11/11/2026`. */
function formatIssuedOn(value: string): string {
  return formatShortDate(value.slice(0, 10))
}

function StatusBadge({ status }: { status: Invoice['status'] }) {
  const meta = INVOICE_STATUS_META[status]

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${meta.badge}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  )
}

function CancelButton({
  invoice,
  onCancel,
}: {
  invoice: Invoice
  onCancel: (invoice: Invoice) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onCancel(invoice)}
      aria-label={`Anular la factura ${invoice.invoice_number}`}
      title="Anular factura"
      className="rounded-lg border border-slate-300 bg-white/85 p-1.5 text-slate-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
    >
      <Ban className="size-4" aria-hidden="true" />
    </button>
  )
}

/**
 * Libro de facturas emitidas.
 *
 * Muestra el número fiscal, el emisor (clave en el modo multi-emisor), el
 * cliente con su documento, el IVA despejado y el total. Las anuladas quedan
 * visibles con su motivo: una factura legal no se borra, se anula.
 */
export function InvoicesTable({ invoices, onCancel }: InvoicesTableProps) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full divide-y divide-slate-200 text-left">
          <caption className="sr-only">Facturas emitidas en AD Clinic</caption>
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className={HEAD_CLASS}>
                Fecha
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Número
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Emisor
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Cliente
              </th>
              <th scope="col" className={`${HEAD_CLASS} text-right`}>
                IVA
              </th>
              <th scope="col" className={`${HEAD_CLASS} text-right`}>
                Total
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Estado
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white/60">

            {invoices.map((invoice) => {
              const cancelled = invoice.status === 'cancelled'

              return (
                <tr key={invoice.id} className={cancelled ? 'bg-slate-50/70' : undefined}>
                  <td className="px-4 py-3">
                    <p className="text-sm text-slate-700">{formatIssuedOn(invoice.issued_at)}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                      {invoice.timbrado_number}
                    </p>
                  </td>

                  <td className="px-4 py-3">
                    <p
                      className={`font-mono text-xs font-semibold ${
                        cancelled ? 'text-slate-400 line-through' : 'text-slate-900'
                      }`}
                    >
                      {invoice.invoice_number}
                    </p>
                    {invoice.cdc && (
                      <p
                        title={invoice.cdc}
                        className="mt-0.5 max-w-40 truncate font-mono text-[10px] text-slate-400"
                      >
                        CDC {invoice.cdc}
                      </p>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <p className="text-sm text-slate-700">{getIssuerName(invoice.issuer)}</p>
                    {invoice.issuer && (
                      <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                        RUC {invoice.issuer.ruc}
                      </p>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <p className="max-w-48 truncate text-sm font-medium text-slate-900">
                      {invoice.customer_name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {getInvoiceCustomerDocument(invoice)}
                    </p>
                  </td>

                  <td className="px-4 py-3 text-right">
                    <p className="text-xs text-slate-600">{VAT_RATE_LABELS[invoice.vat_rate]}</p>
                    <p className="mt-0.5 text-[11px] tabular-nums text-slate-400">
                      {formatPYG(getStoredIvaTotal(invoice))}
                    </p>
                  </td>

                  <td className="px-4 py-3 text-right">
                    <span
                      className={`whitespace-nowrap text-sm font-semibold tabular-nums ${
                        cancelled ? 'text-slate-400 line-through' : 'text-slate-900'
                      }`}
                    >
                      {formatPYG(invoice.total)}
                    </span>
                  </td>

                  <td className="px-4 py-3">
                    <StatusBadge status={invoice.status} />
                    {cancelled && invoice.cancellation_reason && (
                      <p
                        title={invoice.cancellation_reason}
                        className="mt-1 max-w-40 truncate text-[11px] text-slate-400"
                      >
                        {invoice.cancellation_reason}
                      </p>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right">
                    {cancelled ? (
                      <span className="text-[11px] text-slate-400">—</span>
                    ) : (
                      <CancelButton invoice={invoice} onCancel={onCancel} />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-slate-100 md:hidden">
        {invoices.map((invoice) => {
          const cancelled = invoice.status === 'cancelled'

          return (
            <li key={invoice.id} className="px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={invoice.status} />
                    <span className="text-xs text-slate-400">
                      {formatIssuedOn(invoice.issued_at)}
                    </span>
                  </div>
                  <p
                    className={`mt-1.5 font-mono text-xs font-semibold ${
                      cancelled ? 'text-slate-400 line-through' : 'text-slate-900'
                    }`}
                  >
                    {invoice.invoice_number}
                  </p>
                  <p className="mt-1 truncate text-sm text-slate-700">{invoice.customer_name}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {getIssuerName(invoice.issuer)} · {VAT_RATE_LABELS[invoice.vat_rate]}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={`whitespace-nowrap text-sm font-semibold tabular-nums ${
                      cancelled ? 'text-slate-400 line-through' : 'text-slate-900'
                    }`}
                  >
                    {formatPYG(invoice.total)}
                  </p>
                  <p className="mt-0.5 whitespace-nowrap text-[11px] tabular-nums text-slate-400">
                    IVA {formatPYG(getStoredIvaTotal(invoice))}
                  </p>
                </div>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                <span className="truncate text-xs text-slate-500">
                  {getInvoiceCustomerDocument(invoice)}
                </span>
                {!cancelled && (
                  <button
                    type="button"
                    onClick={() => onCancel(invoice)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white/85 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  >
                    <Ban className="size-3.5" aria-hidden="true" />
                    Anular
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
