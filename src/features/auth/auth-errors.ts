/**
 * Traduce los errores de Supabase Auth a mensajes en español listos para la UI.
 * Se apoya en `error.code` (estable) y, como respaldo, en el texto del mensaje.
 */

type AuthErrorLike = {
  code?: string | null
  message?: string
}

const OFFLINE_MESSAGE = 'No hay conexión. Revisa tu red e inténtalo de nuevo.'

const RATE_LIMIT_MESSAGE =
  'Demasiados intentos seguidos. Espera unos minutos e inténtalo de nuevo.'

const MESSAGES_BY_CODE: Record<string, string> = {
  invalid_credentials: 'Correo o contraseña incorrectos.',
  email_not_confirmed: 'Debes confirmar tu correo antes de iniciar sesión.',
  email_address_invalid: 'El correo electrónico no tiene un formato válido.',
  email_address_not_authorized: 'Ese correo no está autorizado para acceder a la clínica.',
  user_banned: 'Esta cuenta está bloqueada. Contacta con la administración de la clínica.',
  over_request_rate_limit: RATE_LIMIT_MESSAGE,
  over_email_send_rate_limit: RATE_LIMIT_MESSAGE,
  session_not_found: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
  session_expired: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
  weak_password: 'La contraseña es demasiado débil.',
  same_password: 'La nueva contraseña debe ser distinta de la anterior.',
}

const MESSAGES_BY_TEXT: ReadonlyArray<readonly [RegExp, string]> = [
  [/invalid login credentials/i, MESSAGES_BY_CODE.invalid_credentials],
  [/email not confirmed/i, MESSAGES_BY_CODE.email_not_confirmed],
  [/failed to fetch|network ?error|network request failed|load failed/i, OFFLINE_MESSAGE],
  [/rate limit|too many requests/i, RATE_LIMIT_MESSAGE],
  [/jwt expired|invalid jwt|session.*(missing|expired)/i, MESSAGES_BY_CODE.session_expired],
]

const FALLBACK_MESSAGE = 'No se pudo completar la operación. Inténtalo de nuevo.'

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function toAuthErrorLike(error: unknown): AuthErrorLike {
  if (error instanceof Error) {
    const { message } = error
    const { code } = error as Error & AuthErrorLike
    return { code: code ?? null, message }
  }

  if (typeof error === 'object' && error !== null) {
    const { code, message } = error as AuthErrorLike
    return { code: code ?? null, message }
  }

  if (typeof error === 'string') return { message: error }

  return {}
}

export function getAuthErrorMessage(error: unknown): string {
  // Sin red no hay nada que consultar: el mensaje de Supabase sería genérico.
  if (isOffline()) return OFFLINE_MESSAGE

  const { code, message } = toAuthErrorLike(error)

  if (code && MESSAGES_BY_CODE[code]) return MESSAGES_BY_CODE[code]

  if (message) {
    for (const [pattern, translated] of MESSAGES_BY_TEXT) {
      if (pattern.test(message)) return translated
    }
  }

  return FALLBACK_MESSAGE
}
