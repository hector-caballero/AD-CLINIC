import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente base de Supabase para AD Clinic.
 *
 * Las credenciales se leen de `import.meta.env` (Vite solo expone las variables
 * con prefijo `VITE_`). Consulta `.env.example` para saber qué valores necesitas.
 *
 * La `anon key` es pública por diseño: la seguridad real la dan las políticas
 * RLS de cada tabla en Supabase.
 */

const MISSING_ENV_HINT =
  'Copia `.env.example` a `.env` (o `.env.local`) y define la variable con el valor de tu proyecto Supabase.'

function readEnvVar(name: string, value: string | undefined): string {
  const trimmed = value?.trim()

  if (!trimmed) {
    throw new Error(`[AD Clinic] Falta la variable de entorno ${name}. ${MISSING_ENV_HINT}`)
  }

  return trimmed
}

function assertIsHttpUrl(name: string, value: string): void {
  try {
    const { protocol } = new URL(value)

    if (protocol === 'http:' || protocol === 'https:') return
  } catch {
    // Se maneja abajo con un mensaje único.
  }

  throw new Error(`[AD Clinic] ${name} debe ser una URL http(s) válida. Recibido: "${value}".`)
}

/**
 * Evita el error más caro posible: subir la `service_role` key al bundle del
 * navegador (saltaría todas las políticas RLS y expondría datos de pacientes).
 */
function assertPublicAnonKey(anonKey: string): void {
  const [, payload] = anonKey.split('.')

  if (!payload) return // Formato no JWT (p. ej. claves nuevas `sb_publishable_...`): nada que validar.

  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const { role } = JSON.parse(atob(padded)) as { role?: string }

    if (role === 'service_role') {
      throw new Error(
        '[AD Clinic] VITE_SUPABASE_ANON_KEY contiene una `service_role` key. ' +
          'Esa clave nunca debe llegar al navegador: usa la clave `anon` / `publishable`.',
      )
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('[AD Clinic]')) throw error
    // Si el payload no es decodificable, no bloqueamos el arranque.
  }
}

const supabaseUrl = readEnvVar('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL)
const supabaseAnonKey = readEnvVar(
  'VITE_SUPABASE_ANON_KEY',
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

assertIsHttpUrl('VITE_SUPABASE_URL', supabaseUrl)
assertPublicAnonKey(supabaseAnonKey)

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Mantiene la sesión entre recargas y la refresca automáticamente,
    // imprescindible para que la PWA siga funcionando al reabrirse offline.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: 'ad-clinic-auth',
  },
  db: {
    schema: 'public',
  },
})

export default supabase
