import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchPatientTransactionLinks,
  type PatientTransactionLink,
} from '../cash/cash-service'
import {
  fetchPatientInvoices,
  fetchTransactionInvoicing,
  type TransactionInvoicing,
} from '../invoicing/invoicing-service'
import type { Invoice } from '../invoicing/invoicing-types'
import { buildPlanFinancials, type PlanFinancialSummary } from './odontogram-financials'
import type { OdontogramItem } from './odontogram-types'

type PlanFinancialsSnapshot = {
  /** `paciente|recarga` al que pertenece la respuesta. */
  key: string
  invoices: Invoice[]
  transactions: PatientTransactionLink[]
  invoicing: Map<string, TransactionInvoicing>
}

const EMPTY_INVOICING = new Map<string, TransactionInvoicing>()

/** Mismo tope que la caja: `.in()` con muchos ids arma URLs largas. */
const INVOICING_CHUNK_SIZE = 100

/**
 * Estado de cobro y facturación del paciente para el plan del odontograma.
 *
 * Consulta en paralelo sus facturas emitidas y sus movimientos de caja
 * (cargos y pagos) y, con esos ids, el estado de facturación de cada cobro en
 * `transaction_invoicing`. El resumen se recalcula con `buildPlanFinancials`
 * cuando cambian las líneas del plan (por ejemplo al cobrarlas en caja), así el
 * panel queda en vivo sin recargar la página.
 */
export function usePlanFinancials(patientId: string | null, items: OdontogramItem[]) {
  const [snapshot, setSnapshot] = useState<PlanFinancialsSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const requestKey = `${patientId ?? 'sin-paciente'}|${reloadToken}`

  useEffect(() => {
    if (!patientId) return

    let isCurrent = true
    const id = patientId
    const key = `${id}|${reloadToken}`

    async function load() {
      const [invoices, transactions] = await Promise.all([
        fetchPatientInvoices(id),
        fetchPatientTransactionLinks(id),
      ])

      const paymentIds = transactions
        .filter((row) => row.type === 'payment')
        .map((row) => row.id)
      const chunks: string[][] = []

      for (let index = 0; index < paymentIds.length; index += INVOICING_CHUNK_SIZE) {
        chunks.push(paymentIds.slice(index, index + INVOICING_CHUNK_SIZE))
      }

      const invoicingRows = (await Promise.all(chunks.map((chunk) => fetchTransactionInvoicing(chunk))))
        .flat()

      if (!isCurrent) return

      setSnapshot({
        key,
        invoices,
        transactions,
        invoicing: new Map(invoicingRows.map((row) => [row.transaction_id, row] as const)),
      })
      setError(null)
    }

    load().catch((cause: unknown) => {
      if (!isCurrent) return

      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo cargar el estado de cobro y facturación del plan.',
      )
    })

    return () => {
      isCurrent = false
    }
  }, [patientId, reloadToken])

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  // Nunca se muestran datos de otro paciente mientras llega la respuesta.
  const current =
    patientId && snapshot && snapshot.key.startsWith(`${patientId}|`) ? snapshot : null
  const isLoading = Boolean(patientId) && snapshot?.key !== requestKey

  const summary = useMemo(
    () =>
      buildPlanFinancials({
        items,
        invoices: current?.invoices ?? [],
        transactions: current?.transactions ?? [],
        invoicing: current?.invoicing ?? EMPTY_INVOICING,
      }),
    [items, current],
  )

  return {
    summary,
    /** `false` hasta que llega la primera respuesta del paciente activo. */
    hasData: Boolean(current),
    isLoading,
    error,
    reload,
  } satisfies {
    summary: PlanFinancialSummary
    hasData: boolean
    isLoading: boolean
    error: string | null
    reload: () => void
  }
}
