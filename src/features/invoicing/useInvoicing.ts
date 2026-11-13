import { useCallback, useEffect, useState } from 'react'
import {
  fetchClinicTaxSettings,
  fetchTaxIssuers,
  fetchTimbrados,
} from './invoicing-service'
import type {
  ClinicTaxSettings,
  InvoicingTimbrado,
  TaxIssuer,
} from './invoicing-types'

type InvoicingSnapshot = {
  reloadToken: number
  settings: ClinicTaxSettings | null
  issuers: TaxIssuer[]
  timbrados: InvoicingTimbrado[]
}

/** Referencias estables mientras no hay datos (evitan re-renders innecesarios). */
const EMPTY_ISSUERS: TaxIssuer[] = []
const EMPTY_TIMBRADOS: InvoicingTimbrado[] = []

/**
 * Configuración fiscal + emisores + timbrados.
 *
 * La usan el formulario de emisión (para sugerir el emisor y el timbrado) y la
 * pestaña de configuración. Las tres consultas salen en paralelo y comparten un
 * único estado de carga/error: si falta la migración, la pantalla lo informa
 * una sola vez en lugar de fallar tres veces.
 */
export function useInvoicing() {
  const [snapshot, setSnapshot] = useState<InvoicingSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  const isLoading = snapshot?.reloadToken !== reloadToken

  useEffect(() => {
    let isCurrent = true

    Promise.all([fetchClinicTaxSettings(), fetchTaxIssuers(), fetchTimbrados()])
      .then(([settings, issuers, timbrados]) => {
        if (!isCurrent) return

        setSnapshot({ reloadToken, settings, issuers, timbrados })
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return

        setError(
          cause instanceof Error
            ? cause.message
            : 'No se pudo cargar la configuración fiscal del consultorio.',
        )
      })

    return () => {
      isCurrent = false
    }
  }, [reloadToken])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  return {
    settings: snapshot?.settings ?? null,
    issuers: snapshot?.issuers ?? EMPTY_ISSUERS,
    timbrados: snapshot?.timbrados ?? EMPTY_TIMBRADOS,
    isLoading,
    error,
    reload,
  }
}
