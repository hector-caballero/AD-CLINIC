import { createContext, useContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { StaffRole } from '../team/team-types'

export type SignInResult = { error: string | null }

/**
 * Fila de `public.profiles` del usuario autenticado.
 * Es la fuente del rol: Supabase Auth no lo conoce.
 */
export type AuthProfile = {
  id: string
  full_name: string
  email: string | null
  role: StaffRole
  is_active: boolean
}

/** Columnas que se piden al cargar el perfil. */
export const AUTH_PROFILE_SELECT = 'id, full_name, email, role, is_active'

export type AuthContextValue = {
  /** Sesión activa de Supabase (`null` si nadie ha iniciado sesión). */
  session: Session | null
  /** Atajo a `session.user`. */
  user: User | null
  /** Perfil del personal (`public.profiles`); `null` si no existe o no cargó. */
  profile: AuthProfile | null
  /** Rol del usuario, atajo de `profile.role`. */
  role: StaffRole | null
  /** `true` si el perfil tiene rol `admin` y el acceso está habilitado. */
  isAdmin: boolean
  /** `true` mientras se resuelve la sesión inicial guardada en el dispositivo. */
  isLoading: boolean
  /** `true` mientras se carga el perfil del usuario. */
  isLoadingProfile: boolean
  /** `true` mientras hay un intento de login en curso. */
  isSigningIn: boolean
  /** Atajo a `session !== null`. */
  isAuthenticated: boolean
  /** Vuelve a leer el perfil (por ejemplo, después de editar el propio nombre). */
  refreshProfile: () => Promise<void>
  /**
   * Inicia sesión con email y contraseña.
   * Devuelve `error: null` si todo fue bien o el mensaje ya traducido al español.
   */
  signIn: (email: string, password: string) => Promise<SignInResult>
  /** Cierra la sesión también cuando no hay conexión (fallback local). */
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

/** Acceso al contexto de autenticación. Debe usarse dentro de `<AuthProvider>`. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('[AD Clinic] useAuth() debe usarse dentro de <AuthProvider>.')
  }

  return context
}
