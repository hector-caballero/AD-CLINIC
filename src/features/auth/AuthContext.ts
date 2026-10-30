import { createContext, useContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export type SignInResult = { error: string | null }

export type AuthContextValue = {
  /** Sesión activa de Supabase (`null` si nadie ha iniciado sesión). */
  session: Session | null
  /** Atajo a `session.user`. */
  user: User | null
  /** `true` mientras se resuelve la sesión inicial guardada en el dispositivo. */
  isLoading: boolean
  /** `true` mientras hay un intento de login en curso. */
  isSigningIn: boolean
  /** Atajo a `session !== null`. */
  isAuthenticated: boolean
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
