/**
 * Traducción de errores de PostgREST / Supabase para la anamnesis.
 *
 * Se mantiene separado de `patient-errors.ts` porque los códigos que importan
 * acá son otros (el `upsert` necesita la clave única por paciente, el peso
 * tiene su propio CHECK, etc.) y porque el mensaje tiene que decir qué
 * migración aplicar, no hablar de "fichas".
 */

type PostgrestLikeError = {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

const NETWORK_PATTERN =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout|timed out|econn|enotfound|offline/i

const GENERIC_MESSAGE = 'No se pudo guardar la historia clínica. Intentá de nuevo.'

const MIGRATION_HINT =
  'La tabla de anamnesis no existe. Aplicá la migración `20261104130000_patient_medical_history.sql` en Supabase.'

/** Convierte el error crudo de Supabase en un mensaje para la interfaz. */
export function getAnamnesisErrorMessage(error: unknown): string {
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
    case '42P01':
    case 'PGRST205':
      // `PGRST205` es el que devuelve PostgREST cuando la tabla todavía no está
      // en el esquema remoto (migración sin aplicar).
      return MIGRATION_HINT
    case 'PGRST204':
      return 'Falta una columna en `patient_medical_history`. Verificá la migración aplicada.'
    case '42P10':
      // `upsert` sin la restricción única que menciona `on conflict`.
      return 'La tabla no tiene la clave única por paciente. Volvé a aplicar la migración `20261104130000_patient_medical_history.sql`.'
    case '23503':
      return 'El paciente ya no existe o fue eliminado. Cerrá la ficha y recargá el listado.'
    case '23514':
      if (/child_weight/i.test(rawMessage) || /child_weight/i.test(candidate.details ?? '')) {
        return 'El peso debe estar entre 0,01 kg y 250 kg.'
      }

      return 'Alguno de los datos no cumple el formato permitido. Revisá el peso y los textos.'
    case '23505':
      return 'Ya existe una anamnesis para este paciente. Cerrá la ficha y volvé a abrirla.'
    case '42501':
    case 'PGRST301':
    case 'PGRST303':
      return 'Tu sesión no tiene permisos para esta operación. Volvé a iniciar sesión.'
    default:
      break
  }

  return rawMessage || GENERIC_MESSAGE
}

/** Envuelve cualquier fallo en un `Error` con mensaje ya traducido. */
export function toAnamnesisError(error: unknown): Error {
  return new Error(getAnamnesisErrorMessage(error))
}
