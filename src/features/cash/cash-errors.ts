/**
 * Traducción de errores de PostgREST / Supabase a mensajes accionables en
 * español para la caja.
 *
 * Códigos relevantes de `transactions` / `patient_treatments`:
 * - `23505`: número de recibo repetido (índice único `receipt_number`).
 * - `23514`: monto ≤ 0, moneda inválida o método de pago en un cargo.
 * - `23503`: el paciente o el tratamiento ya no existe.
 * - `PGRST200`: la relación embebida del `select` no existe (falta la FK).
 */

type PostgrestLikeError = {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

const NETWORK_PATTERN =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out|econn|enotfound|offline/i

const GENERIC_MESSAGE = 'No se pudo completar la operación de caja. Intentá de nuevo.'

export function getCashErrorMessage(error: unknown): string {
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
    case '23505':
      return /receipt/i.test(`${rawMessage} ${candidate.details ?? ''}`)
        ? 'Ya existe un movimiento con ese número de recibo. Usá otro número.'
        : 'Ese movimiento ya fue registrado. Actualizá el historial y volvé a intentar.'
    case '23502':
      return 'Faltan datos obligatorios del movimiento: paciente, tipo o monto.'
    case '23503':
      return 'El paciente o el tratamiento seleccionado ya no existe. Actualizá los datos y volvé a intentar.'
    case '23514':
      return 'Revisá el movimiento: el monto debe ser mayor a cero y los cargos no llevan método de pago.'
    case '22003':
      return 'El monto es demasiado grande para la columna numérica de la caja. Revisá el importe.'
    case '22P02':
      return 'El formato del movimiento no es válido (tipo, estado o método de pago).'
    case '42501':
    case 'PGRST301':
    case 'PGRST303':
      return 'Tu sesión no tiene permisos para registrar movimientos de caja. Volvé a iniciar sesión.'
    case '42P01':
      return 'Falta una tabla de caja en la base. Aplicá la migración SQL en Supabase.'
    case '42703':
    case 'PGRST204':
      return 'Falta una columna en las tablas de caja. Verificá la migración aplicada.'
    case 'PGRST200':
      return 'La consulta de movimientos no encontró la relación con pacientes o tratamientos. Verificá las claves foráneas en Supabase.'
    default:
      break
  }

  return rawMessage || GENERIC_MESSAGE
}

/** Envuelve cualquier fallo en un `Error` con el mensaje ya traducido. */
export function toCashError(error: unknown): Error {
  return new Error(getCashErrorMessage(error))
}
