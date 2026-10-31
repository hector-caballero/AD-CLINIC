/**
 * Traducción de errores del módulo de equipo (`public.profiles` + Edge Function
 * `team-admin`) a mensajes accionables en español.
 */

type PostgrestLikeError = {
  code?: string
  message?: string
  details?: string | null
}

const NETWORK_PATTERN = /failed to fetch|networkerror|network request failed|load failed|fetch failed/i
const FUNCTION_PATTERN = /non-2xx|edge function returned|functionshttperror|relay error/i

const GENERIC_MESSAGE = 'No se pudo completar la operación. Intentá de nuevo.'
const MISSING_FUNCTION_MESSAGE =
  'La función `team-admin` no respondió. Verificá que esté desplegada con `supabase functions deploy team-admin`.'
const OFFLINE_MESSAGE = 'No hay conexión con el servidor. Revisá tu internet y volvé a intentar.'

/**
 * @param detail mensaje crudo (de PostgREST, de Auth o de la función)
 * @param fromAuth `true` cuando el error viene de la Edge Function, no de la tabla
 */
export function getTeamErrorMessage(detail: unknown, fromAuth = false): string {
  const code =
    typeof detail === 'object' && detail !== null ? (detail as PostgrestLikeError).code : undefined
  const message =
    typeof detail === 'string'
      ? detail
      : detail instanceof Error
        ? detail.message
        : ((detail as PostgrestLikeError | null)?.message ?? '')

  const raw = message.trim()
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine

  if (isOffline || NETWORK_PATTERN.test(raw)) return OFFLINE_MESSAGE

  if (/al menos un administrador/i.test(raw)) return raw
  if (/solo un usuario con rol de administraci|perfil activo/i.test(raw)) return raw
  if (/ya existe una cuenta/i.test(raw)) return raw
  if (/contrase/i.test(raw) && /caracteres/i.test(raw)) return raw

  if (fromAuth && FUNCTION_PATTERN.test(raw)) return MISSING_FUNCTION_MESSAGE

  switch (code) {
    case '23514':
      return 'La clínica necesita al menos un administrador activo.'
    case '23505':
      return 'Ya existe un usuario con ese correo electrónico.'
    case '42501':
    case 'PGRST301':
    case 'PGRST303':
      return 'Tu sesión no tiene permisos para gestionar el equipo. Volvé a iniciar sesión.'
    case '42P01':
      return 'La tabla de perfiles no existe. Aplicá la migración SQL en Supabase.'
    case 'PGRST204':
      return 'Falta una columna en la tabla de perfiles. Verificá la migración aplicada.'
    default:
      break
  }

  return raw || GENERIC_MESSAGE
}

/** Envuelve cualquier fallo en un `Error` con mensaje ya traducido. */
export function toTeamError(error: unknown): Error {
  return new Error(getTeamErrorMessage(error))
}
