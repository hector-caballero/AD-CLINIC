/**
 * Traducción de errores de PostgREST / Supabase a mensajes accionables en español
 * para el catálogo de tratamientos.
 */

type PostgrestLikeError = {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

const NETWORK_PATTERN =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out|econn|enotfound|offline/i

const GENERIC_MESSAGE = 'No se pudo completar la operación. Intentá de nuevo.'

export function getTreatmentErrorMessage(error: unknown): string {
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

  if (/default_duration_minutes/i.test(rawMessage)) {
    return 'La duración debe estar entre 5 y 600 minutos.'
  }

  if (/default_price/i.test(rawMessage)) {
    return 'El precio no puede ser negativo.'
  }

  switch (candidate.code) {
    case '23502':
      return 'Faltan datos obligatorios del tratamiento.'
    case '23505':
      return 'Ya existe un tratamiento con ese código. Usá otro (por ejemplo, PRO-006).'
    case '23514':
      return 'Alguno de los datos no cumple el formato permitido. Revisá el precio o la duración.'
    case '23503':
      return 'No se puede aplicar el cambio porque el tratamiento está asociado a fichas de pacientes.'
    case '22P02':
      return 'El formato de un dato no es válido para la base de datos.'
    case '42501':
    case 'PGRST301':
    case 'PGRST303':
      return 'Tu sesión no tiene permisos para esta operación. Volvé a iniciar sesión.'
    case '42P01':
      return 'La tabla de tratamientos no existe. Aplicá la migración SQL en Supabase.'
    case 'PGRST204':
      return 'Falta una columna en la tabla de tratamientos. Verificá la migración aplicada.'
    default:
      break
  }

  return rawMessage || GENERIC_MESSAGE
}

/** Envuelve cualquier fallo en un `Error` con mensaje ya traducido. */
export function toTreatmentError(error: unknown): Error {
  return new Error(getTreatmentErrorMessage(error))
}
