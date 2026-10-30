/**
 * Traducción de errores de PostgREST / Supabase a mensajes accionables en español.
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

/**
 * Convierte el error crudo de Supabase en un mensaje para mostrar en la UI.
 * Nunca devuelve el mensaje técnico en inglés salvo como último recurso.
 */
export function getPatientErrorMessage(error: unknown): string {
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

  if (/document_type/i.test(rawMessage) || /document_type/i.test(candidate.details ?? '')) {
    return 'El tipo de documento no está permitido por la base de datos. Revisá el esquema de patients.'
  }

  switch (candidate.code) {
    case '23502':
      return 'Faltan datos obligatorios del paciente.'
    case '23505':
      return 'Ya existe un paciente con esos datos. Revisá el documento o el teléfono.'
    case '23514':
      return 'Alguno de los datos no cumple el formato permitido. Revisá el teléfono, el email o el documento.'
    case '22P02':
      return 'El formato de un dato no es válido para la base de datos.'
    case '42501':
    case 'PGRST301':
    case 'PGRST303':
      return 'Tu sesión no tiene permisos para esta operación. Volvé a iniciar sesión.'
    case '42P01':
      return 'La tabla de pacientes no existe. Aplicá la migración SQL en Supabase.'
    case 'PGRST204':
      return 'Falta una columna en la tabla de pacientes. Verificá la migración aplicada.'
    default:
      break
  }

  return rawMessage || GENERIC_MESSAGE
}

/** Envuelve cualquier fallo en un `Error` con mensaje ya traducido. */
export function toPatientError(error: unknown): Error {
  return new Error(getPatientErrorMessage(error))
}
