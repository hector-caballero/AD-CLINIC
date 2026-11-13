import { useMemo, useState } from 'react'
import {
  AlertCircle,
  FileText,
  Loader2,
  Plus,
  Receipt,
  RefreshCw,
  SearchX,
  X,
} from 'lucide-react'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { formatPYG } from '../lib/format'
import { CancelInvoiceModal } from '../features/invoicing/CancelInvoiceModal'
import { ExpenseInvoiceFormModal } from '../features/invoicing/ExpenseInvoiceFormModal'
import { ExpensesTable } from '../features/invoicing/ExpensesTable'
import { InvoiceFormModal, type InvoiceSeed } from '../features/invoicing/InvoiceFormModal'
import { InvoicingSettings } from '../features/invoicing/InvoicingSettings'
import { InvoicesTable } from '../features/invoicing/InvoicesTable'
import { deleteExpenseInvoice } from '../features/invoicing/invoicing-service'
import type { ExpenseInvoice, Invoice } from '../features/invoicing/invoicing-types'
import { useInvoiceLedger } from '../features/invoicing/useInvoiceLedger'
import { useInvoicing } from '../features/invoicing/useInvoicing'
import { usePatients } from '../features/patients/usePatients'

type LedgerTab = 'invoices' | 'expenses' | 'settings'

const TABS: { value: LedgerTab; label: string }[] = [
  { value: 'invoices', label: 'Facturas' },
  { value: 'expenses', label: 'Gastos' },
  { value: 'settings', label: 'Configuración' },
]

const PRIMARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-70'

const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white/85 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50'

const INPUT_CLASS =
  'w-full rounded-xl border border-slate-300 bg-white/85 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500'

/**
 * Facturación y gastos del consultorio.
 *
 * Tres pestañas:
 * - Facturas: libro de comprobantes emitidos (con anulación y motivo).
 * - Gastos: facturas de compra/insumos, editables y borrables.
 * - Configuración: modo operativo (multi-emisor o empresa única), emisores y
 *   timbrados de la SET.
 *
 * El número de factura lo resuelve la base al emitir; acá se ve el resultado.
 */
export default function InvoicingPage() {
  const { patients } = usePatients()
  const invoicing = useInvoicing()
  const ledger = useInvoiceLedger()

  const [tab, setTab] = useState<LedgerTab>('invoices')
  const [invoiceQuery, setInvoiceQuery] = useState('')
  const [expenseQuery, setExpenseQuery] = useState('')
  const [issueSeed, setIssueSeed] = useState<InvoiceSeed | null>(null)
  const [expenseModal, setExpenseModal] = useState<{ expense: ExpenseInvoice | null } | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Invoice | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ExpenseInvoice | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const visibleInvoices = useMemo(() => {
    const term = invoiceQuery.trim().toLowerCase()

    if (!term) return ledger.invoices

    return ledger.invoices.filter((invoice) =>
      [
        invoice.invoice_number,
        invoice.customer_name,
        invoice.customer_ruc ?? '',
        invoice.issuer?.display_name ?? '',
        invoice.timbrado_number,
      ]
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [invoiceQuery, ledger.invoices])

  const visibleExpenses = useMemo(() => {
    const term = expenseQuery.trim().toLowerCase()

    if (!term) return ledger.expenses

    return ledger.expenses.filter((expense) =>
      [
        expense.supplier_name,
        expense.supplier_ruc ?? '',
        expense.invoice_number,
        expense.expense_kind ?? '',
        expense.attributed_issuer?.display_name ?? '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(term),
    )
  }, [expenseQuery, ledger.expenses])

  const issuedTotal = useMemo(
    () =>
      ledger.invoices
        .filter((invoice) => invoice.status === 'issued')
        .reduce((total, invoice) => total + invoice.total, 0),
    [ledger.invoices],
  )

  const expensesTotal = useMemo(
    () => ledger.expenses.reduce((total, expense) => total + expense.total, 0),
    [ledger.expenses],
  )

  function handleIssued(invoice: Invoice) {
    ledger.addInvoice(invoice)
    setIssueSeed(null)
    setTab('invoices')
    setNotice(`Factura ${invoice.invoice_number} emitida por ${formatPYG(invoice.total)}.`)
  }

  function handleCancelled(invoice: Invoice) {
    ledger.replaceInvoice(invoice)
    setCancelTarget(null)
    setNotice(`Factura ${invoice.invoice_number} anulada.`)
  }

  function handleExpenseSaved(expense: ExpenseInvoice) {
    const exists = ledger.expenses.some((item) => item.id === expense.id)

    if (exists) ledger.replaceExpense(expense)
    else ledger.addExpense(expense)

    setExpenseModal(null)
    setNotice(
      exists ? 'Gasto actualizado.' : `Gasto de ${expense.supplier_name} registrado.`,
    )
  }

  async function handleDeleteExpense() {
    if (!deleteTarget || isDeleting) return

    setIsDeleting(true)
    setDeleteError(null)

    try {
      await deleteExpenseInvoice(deleteTarget.id)
      ledger.removeExpense(deleteTarget.id)
      setDeleteTarget(null)
      setNotice('Gasto eliminado.')
    } catch (cause) {
      setDeleteError(
        cause instanceof Error ? cause.message : 'No se pudo borrar el gasto. Volvé a intentar.',
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Secciones de facturación"
          className="flex w-fit flex-wrap gap-1 rounded-xl bg-white/70 p-1 ring-1 ring-slate-200"
        >
          {TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              onClick={() => {
                setTab(item.value)
                setNotice(null)
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === item.value
                  ? 'bg-brand-500 text-ink-950 shadow-sm'
                  : 'text-slate-600 hover:bg-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {tab === 'invoices' && (
            <button
              type="button"
              onClick={() => {
                setNotice(null)
                setIssueSeed({})
              }}
              className={PRIMARY_BUTTON_CLASS}
            >
              <Plus className="size-4" aria-hidden="true" />
              Emitir factura
            </button>
          )}
          {tab === 'expenses' && (
            <button
              type="button"
              onClick={() => {
                setNotice(null)
                setExpenseModal({ expense: null })
              }}
              className={PRIMARY_BUTTON_CLASS}
            >
              <Plus className="size-4" aria-hidden="true" />
              Registrar gasto
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800"
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

      {tab === 'settings' && (
        <InvoicingSettings
          settings={invoicing.settings}
          issuers={invoicing.issuers}
          timbrados={invoicing.timbrados}
          isLoading={invoicing.isLoading}
          error={invoicing.error}
          onReload={invoicing.reload}
        />
      )}

      {tab === 'invoices' && (
        <section
          aria-label="Facturas emitidas"
          aria-busy={ledger.isLoading}
          className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/85 shadow-card backdrop-blur-md"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <FileText
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={invoiceQuery}
                onChange={(event) => setInvoiceQuery(event.target.value)}
                placeholder="Buscar número, cliente o emisor"
                aria-label="Buscar facturas"
                className={`${INPUT_CLASS} pl-9`}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-slate-500">
                Facturado:{' '}
                <span className="font-semibold tabular-nums text-emerald-700">
                  {formatPYG(issuedTotal)}
                </span>
              </p>
              <button
                type="button"
                onClick={ledger.reload}
                disabled={ledger.isLoading}
                className={SECONDARY_BUTTON_CLASS}
              >
                <RefreshCw
                  className={`size-4 ${ledger.isLoading ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                Actualizar
              </button>
            </div>
          </div>

          {ledger.error ? (
            <div role="alert" className="flex flex-col items-center px-6 py-16 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                <AlertCircle className="size-7" aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-sm font-semibold text-slate-900">
                No pudimos cargar las facturas
              </h2>
              <p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-500">{ledger.error}</p>
              <button type="button" onClick={ledger.reload} className={`mt-5 ${PRIMARY_BUTTON_CLASS}`}>
                <RefreshCw className="size-4" aria-hidden="true" />
                Reintentar
              </button>
            </div>
          ) : ledger.isLoading && ledger.invoices.length === 0 ? (
            <div
              role="status"
              aria-live="polite"
              className="flex flex-col items-center gap-3 px-6 py-20 text-center"
            >
              <Loader2 className="size-6 animate-spin text-brand-600" aria-hidden="true" />
              <p className="text-sm text-slate-500">Cargando las facturas…</p>
            </div>
          ) : visibleInvoices.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                {invoiceQuery.trim() ? (
                  <SearchX className="size-7" aria-hidden="true" />
                ) : (
                  <Receipt className="size-7" aria-hidden="true" />
                )}
              </span>
              <h2 className="mt-4 text-sm font-semibold text-slate-900">
                {invoiceQuery.trim()
                  ? 'Sin resultados para esa búsqueda'
                  : 'Todavía no hay facturas emitidas'}
              </h2>
              <p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
                {invoiceQuery.trim()
                  ? 'Probá con otro número, cliente o emisor.'
                  : 'Emití la primera factura desde un cobro de caja o con el botón «Emitir factura».'}
              </p>
              {invoiceQuery.trim() ? (
                <button
                  type="button"
                  onClick={() => setInvoiceQuery('')}
                  className={`mt-5 ${SECONDARY_BUTTON_CLASS}`}
                >
                  Limpiar búsqueda
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIssueSeed({})}
                  className={`mt-5 ${PRIMARY_BUTTON_CLASS}`}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Emitir factura
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500 sm:px-5">
                <span>
                  Mostrando{' '}
                  <span className="font-semibold text-slate-700">{visibleInvoices.length}</span> de{' '}
                  {ledger.invoices.length} facturas
                </span>
                <span>Las anuladas se conservan con su motivo</span>
              </div>
              <InvoicesTable invoices={visibleInvoices} onCancel={setCancelTarget} />
            </>
          )}
        </section>
      )}

      {tab === 'expenses' && (
        <section
          aria-label="Facturas de gasto"
          aria-busy={ledger.isLoading}
          className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/85 shadow-card backdrop-blur-md"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Receipt
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={expenseQuery}
                onChange={(event) => setExpenseQuery(event.target.value)}
                placeholder="Buscar proveedor, RUC o comprobante"
                aria-label="Buscar gastos"
                className={`${INPUT_CLASS} pl-9`}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-slate-500">
                Gastos:{' '}
                <span className="font-semibold tabular-nums text-red-700">
                  {formatPYG(expensesTotal)}
                </span>
              </p>
              <button
                type="button"
                onClick={ledger.reload}
                disabled={ledger.isLoading}
                className={SECONDARY_BUTTON_CLASS}
              >
                <RefreshCw
                  className={`size-4 ${ledger.isLoading ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                Actualizar
              </button>
            </div>
          </div>

          {ledger.error ? (
            <div role="alert" className="flex flex-col items-center px-6 py-16 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                <AlertCircle className="size-7" aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-sm font-semibold text-slate-900">
                No pudimos cargar los gastos
              </h2>
              <p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-500">{ledger.error}</p>
              <button type="button" onClick={ledger.reload} className={`mt-5 ${PRIMARY_BUTTON_CLASS}`}>
                <RefreshCw className="size-4" aria-hidden="true" />
                Reintentar
              </button>
            </div>
          ) : ledger.isLoading && ledger.expenses.length === 0 ? (
            <div
              role="status"
              aria-live="polite"
              className="flex flex-col items-center gap-3 px-6 py-20 text-center"
            >
              <Loader2 className="size-6 animate-spin text-brand-600" aria-hidden="true" />
              <p className="text-sm text-slate-500">Cargando los gastos…</p>
            </div>
          ) : visibleExpenses.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                {expenseQuery.trim() ? (
                  <SearchX className="size-7" aria-hidden="true" />
                ) : (
                  <Receipt className="size-7" aria-hidden="true" />
                )}
              </span>
              <h2 className="mt-4 text-sm font-semibold text-slate-900">
                {expenseQuery.trim()
                  ? 'Sin resultados para esa búsqueda'
                  : 'Todavía no hay gastos registrados'}
              </h2>
              <p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
                {expenseQuery.trim()
                  ? 'Probá con otro proveedor, RUC o número de comprobante.'
                  : 'Cargá las facturas de compra del consultorio para llevar el IVA crédito y los egresos.'}
              </p>
              {expenseQuery.trim() ? (
                <button
                  type="button"
                  onClick={() => setExpenseQuery('')}
                  className={`mt-5 ${SECONDARY_BUTTON_CLASS}`}
                >
                  Limpiar búsqueda
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setExpenseModal({ expense: null })}
                  className={`mt-5 ${PRIMARY_BUTTON_CLASS}`}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Registrar gasto
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500 sm:px-5">
                <span>
                  Mostrando{' '}
                  <span className="font-semibold text-slate-700">{visibleExpenses.length}</span> de{' '}
                  {ledger.expenses.length} gastos
                </span>
                <span>Los gastos no consumen correlativos de la SET</span>
              </div>
              <ExpensesTable
                expenses={visibleExpenses}
                onEdit={(expense) => setExpenseModal({ expense })}
                onDelete={(expense) => {
                  setDeleteError(null)
                  setDeleteTarget(expense)
                }}
              />
            </>
          )}
        </section>
      )}

      <p className="text-xs leading-relaxed text-slate-400">
        Los importes están en guaraníes con IVA incluido. El número de factura lo asigna la base al
        emitir, dentro del timbrado y sin repetir correlativos; el IVA se despeja con los divisores
        de la SET (10 % ÷ 11, 5 % ÷ 21). Una factura emitida no se borra: se anula con su motivo.
      </p>

      {issueSeed && (
        <InvoiceFormModal
          key={issueSeed.transactionId ?? issueSeed.patientId ?? 'new-invoice'}
          patients={patients}
          seed={issueSeed}
          onClose={() => setIssueSeed(null)}
          onIssued={handleIssued}
        />
      )}

      {expenseModal && (
        <ExpenseInvoiceFormModal
          key={expenseModal.expense?.id ?? 'new-expense'}
          issuers={invoicing.issuers}
          expense={expenseModal.expense}
          onClose={() => setExpenseModal(null)}
          onSaved={handleExpenseSaved}
        />
      )}

      {cancelTarget && (
        <CancelInvoiceModal
          key={cancelTarget.id}
          invoice={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={handleCancelled}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Borrar factura de gasto"
          description={`Se va a borrar el gasto de ${deleteTarget.supplier_name} por ${formatPYG(
            deleteTarget.total,
          )}. Esta acción no se puede deshacer.`}
          confirmLabel="Borrar gasto"
          busyLabel="Borrando…"
          isBusy={isDeleting}
          error={deleteError}
          onConfirm={handleDeleteExpense}
          onClose={() => {
            if (isDeleting) return

            setDeleteTarget(null)
            setDeleteError(null)
          }}
        />
      )}
    </div>
  )
}
