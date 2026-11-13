/**
 * Traducción de errores de Supabase / PostgREST del módulo de facturación.
 *
 * Códigos relevantes:
 * - `P0001`: excepción lanzada por `issue_invoice` (mensajes ya en español:
 *   timbrado vencido, número fuera de rango, número repetido, total en cero).
 * - `42P01`: falta una tabla del módulo (migración sin aplicar).
 * - `PGRST202`: falta la función `issue_invoice` / `next_timbrado_sequence`.
 * - `23505`: RUC de emisor repetido o número de factura ya usado.
 * - `23503`: el emisor, timbrado o paciente ya no existe.
 * - `23514`: importes negativos o total distinto de la suma de las franjas.
 */

type PostgrestLikeError = {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

const NETWORK_PATTERN =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out|econn|enotfound|offline/i

const GENERIC_MESSAGE = 'No se pudo completar la operación de facturación. Intentá de nuevo.'

export function getInvoicingErrorMessage(error: unknown): string {
  if (!error) return GENERIC_MESSAGE

  const candidate = error as PostgrestLikeError
  const rawMessage =
    typeof candidate.message === 'string' && candidate.message.trim()
      ? candidate.message.trim()
      : error instanceof Error
        ? error.message
        : ''

  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine

  if (isOffline || NETWORK_PATTERN.test(rawMessage)) {
    return 'No hay conexión con el servidor. Revisá tu internet y volvé a intentar.'
  }

  switch (candidate.code) {
    case 'P0001':
      // Las validaciones de la base ya explican qué pasó y cómo corregirlo.
      return rawMessage || GENERIC_MESSAGE
    case '42P01':
      return 'Faltan las tablas de facturación en la base. Aplicá la migración 20261111100000_invoicing_paraguay.sql en Supabase.'
    case '42703':
    case 'PGRST204':
      return 'Falta una columna del módulo fiscal. Verificá que la migración de facturación esté aplicada.'
    case 'PGRST202':
      return 'Falta la función de emisión en la base. Volvé a aplicar la migración de facturación en Supabase.'
    case '23505':
      if (/ruc/i.test(`${rawMessage} ${candidate.details ?? ''}`)) {
        return 'Ya existe un emisor con ese RUC. Revisá la lista antes de crear otro.'
      }
      if (/number|n[uú]mero|invoice/i.test(`${rawMessage} ${candidate.details ?? ''}`)) {
        return 'Ese número de factura ya fue usado en este timbrado. Usá el correlativo que sigue.'
      }

      return 'Ese registro ya existe. Actualizá la lista y volvé a intentar.'
    case '23503':
      return 'El emisor, el timbrado o el paciente seleccionado ya no existe. Actualizá los datos y volvé a intentar.'
    case '23514':
      return 'Revisá los importes: no pueden ser negativos y el total debe coincidir con la suma de las franjas de IVA.'
    case '23502':
      return 'Faltan datos obligatorios de la factura: emisor, timbrado, número o cliente.'
    case '22P02':
      return 'El formato de la factura no es válido (número, timbrado o forma de pago).'
    case '42501':
    case 'PGRST301':
    case 'PGRST303':
      return 'Tu sesión no tiene permisos para operar el módulo fiscal. Volvé a iniciar sesión.'
    default:
      break
  }

  return rawMessage || GENERIC_MESSAGE
}

/** Envuelve cualquier fallo en un `Error` con el mensaje ya traducido. */
export function toInvoicingError(error: unknown): Error {
  return new Error(getInvoicingErrorMessage(error))
}
