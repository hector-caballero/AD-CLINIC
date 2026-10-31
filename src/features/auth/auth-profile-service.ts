import { supabase } from '../../lib/supabase'
import { AUTH_PROFILE_SELECT, type AuthProfile } from './AuthContext'

/**
 * Lee el perfil del personal (`public.profiles`) del usuario autenticado.
 *
 * Si la tabla o la migración todavía no existen, PostgREST devuelve error y
 * quien llama lo trata como "sin rol conocido" en lugar de romper la app.
 */
export async function fetchAuthProfile(userId: string): Promise<AuthProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(AUTH_PROFILE_SELECT)
    .eq('id', userId)
    .maybeSingle()

  if (error) throw error

  return (data as AuthProfile | null) ?? null
}
