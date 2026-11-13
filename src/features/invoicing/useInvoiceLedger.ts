import { useCallback, useEffect, useState } from 'react'
import { fetchExpenseInvoices, fetchInvoices } from './invoicing-service'
import type { ExpenseInvoice, Invoice } from './invoicing-types'

type LedgerSnapshot = {
  reloadToken: number
  invoices: Invoice[]
  expenses: ExpenseInvoice[]
}

const EMPTY_INVOICES: Invoice[] = []
const EMPTY_EXPENSES: ExpenseInvoice[] = []

/**
 * Libro de facturas emitidas + gastos.
 *
 * Se cargan juntos (misma pantalla) y se actualizan en memoria después de cada
 * alta o anulación para no recargar las dos listas completas.
 */
export function useInvoiceLedger() {
  const [snapshot, setSnapshot] = useState<LedgerSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const isLoading = snapshot?.reloadToken !== reloadToken

  useEffect(() => {
    let isCurrent = true

    Promise.all([fetchInvoices(), fetchExpenseInvoices()])
      .then(([invoices, expenses]) => {
        if (!isCurrent) return

        setSnapshot({ reloadToken, invoices, expenses })
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return

        setError(
          cause instanceof Error
            ? cause.message
            : 'No se pudieron cargar las facturas y los gastos.',
        )
      })

    return () => {
      isCurrent = false
    }
  }, [reloadToken])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  const addInvoice = useCallback((invoice: Invoice) => {
    setSnapshot((current) =>
      current ? { ...current, invoices: [invoice, ...current.invoices] } : current,
    )
  }, [])

  const replaceInvoice = useCallback((invoice: Invoice) => {
    setSnapshot((current) =>
      current
        ? {
            ...current,
            invoices: current.invoices.map((item) =>
              item.id === invoice.id ? invoice : item,
            ),
          }
        : current,
    )
  }, [])

  const addExpense = useCallback((expense: ExpenseInvoice) => {
    setSnapshot((current) =>
      current ? { ...current, expenses: [expense, ...current.expenses] } : current,
    )
  }, [])

  const replaceExpense = useCallback((expense: ExpenseInvoice) => {
    setSnapshot((current) =>
      current
        ? {
            ...current,
            expenses: current.expenses.map((item) =>
              item.id === expense.id ? expense : item,
            ),
          }
        : current,
    )
  }, [])

  const removeExpense = useCallback((expenseId: string) => {
    setSnapshot((current) =>
      current
        ? {
            ...current,
            expenses: current.expenses.filter((item) => item.id !== expenseId),
          }
        : current,
    )
  }, [])

  return {
    invoices: snapshot?.invoices ?? EMPTY_INVOICES,
    expenses: snapshot?.expenses ?? EMPTY_EXPENSES,
    isLoading,
    error,
    reload,
    addInvoice,
    replaceInvoice,
    addExpense,
    replaceExpense,
    removeExpense,
  }
}
