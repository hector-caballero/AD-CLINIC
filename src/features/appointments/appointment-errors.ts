/**
 * Traducción de errores de PostgREST / Supabase a mensajes accionables en
 * español para la agenda.
 *
 * Códigos relevantes de `public.appointments`:
 * - `23P01`: violación de la restricción de exclusión (doble reserva).
 * - `23514`: horario fuera de rango o motivo vacío.
 * - `23503`: el paciente referenciado no existe.
 */

type PostgrestLikeError = {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

const NETWORK_PATTERN =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out|econn|enotfound|offline/i

const GENERIC_MESSAGE = 'No se pudo completar la operación con la cita. Intentá de nuevo.'

export function getAppointmentErrorMessage(error: unknown): string {
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
    case '23P01':
      return 'Ese horario ya está ocupado. Elegí otro horario para la cita.'
    case '23502':
      return 'Faltan datos obligatorios de la cita: paciente, horario o motivo.'
    case '23503':
      return 'El paciente de la cita ya no está disponible. Actualizá la agenda y volvé a intentar.'
    case '23514':
      return 'Revisá el horario y el motivo: la cita debe durar entre 5 minutos y 8 horas, y el motivo no puede quedar vacío.'
    case '22P02':
      return 'El formato de la fecha u hora no es válido. Volvé a elegir el horario.'
    case '42501':
    case 'PGRST301':
    case 'PGRST303':
      return 'Tu sesión no tiene permisos para modificar la agenda. Volvé a iniciar sesión.'
    case '42P01':
      return 'La tabla de citas no existe. Aplicá la migración SQL en Supabase.'
    case '42703':
    case 'PGRST204':
      return 'Falta una columna en la tabla de citas. Verificá la migración aplicada.'
    default:
      break
  }

  return rawMessage || GENERIC_MESSAGE
}

/** Envuelve cualquier fallo en un `Error` con el mensaje ya traducido. */
export function toAppointmentError(error: unknown): Error {
  return new Error(getAppointmentErrorMessage(error))
}
