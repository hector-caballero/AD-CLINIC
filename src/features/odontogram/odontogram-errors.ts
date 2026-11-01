/**
 * Traducción de errores de PostgREST / Supabase a mensajes accionables en
 * español para el odontograma.
 *
 * La base también devuelve mensajes clínicos propios (trigger
 * `validate_odontogram_item`): cuando el error habla de «pieza», se muestra tal
 * cual porque ya está redactado para el odontólogo.
 */

type PostgrestLikeError = {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

const NETWORK_PATTERN =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out|econn|enotfound|offline/i

const GENERIC_MESSAGE = 'No se pudo completar la operación del odontograma. Intentá de nuevo.'

export function getOdontogramErrorMessage(error: unknown): string {
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
      return 'Ese procedimiento ya está registrado en esta pieza y cara. Editá el existente o elegí otra cara.'
    case '23502':
      return 'Faltan datos del procedimiento: pieza, estado o tratamiento.'
    case '23503':
      return 'El paciente o el tratamiento ya no existe. Actualizá los datos y volvé a intentar.'
    case '23514':
      return /pieza/i.test(rawMessage)
        ? rawMessage
        : 'Revisá la pieza, la cara y el estado: el tratamiento requiere un precio y una pieza válida para la dentición.'
    case '42501':
    case 'PGRST301':
    case 'PGRST303':
      return 'Tu perfil no puede registrar tratamientos en el odontograma. Pedí acceso a odontología o administración.'
    case '42P01':
      return 'Faltan las tablas del odontograma en la base. Aplicá la migración SQL en Supabase.'
    case '42703':
    case 'PGRST204':
      return 'Falta una columna en las tablas del odontograma. Verificá la migración aplicada.'
    case 'PGRST200':
      return 'La consulta del odontograma no encontró la relación con el catálogo de tratamientos. Verificá las claves foráneas.'
    case 'PGRST116':
      return 'No se encontró el odontograma del paciente. Recargá la página y volvé a intentar.'
    default:
      break
  }

  return rawMessage || GENERIC_MESSAGE
}

/** Envuelve cualquier fallo en un `Error` con el mensaje ya traducido. */
export function toOdontogramError(error: unknown): Error {
  return new Error(getOdontogramErrorMessage(error))
}
