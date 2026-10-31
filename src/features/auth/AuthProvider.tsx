import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { AuthContext, type AuthContextValue, type AuthProfile, type SignInResult } from './AuthContext'
import { fetchAuthProfile } from './auth-profile-service'
import { getAuthErrorMessage } from './auth-errors'

type AuthProviderProps = {
  children: ReactNode
}

/**
 * Perfil junto con el usuario al que pertenece. Guardarlo así permite derivar
 * "está cargando" comparando con la sesión activa, sin efectos con setState
 * sincrónico ni datos viejos visibles tras un cambio de usuario.
 */
type ProfileState = { userId: string; profile: AuthProfile | null }

/**
 * Mantiene el estado de sesión de Supabase Auth y lo expone vía `useAuth()`.
 *
 * Fuentes de verdad:
 *  1. `getSession()` al montar: recupera la sesión persistida en el dispositivo.
 *  2. `onAuthStateChange()`: login, logout, refresh de token y sesión caducada.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [profileState, setProfileState] = useState<ProfileState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSigningIn, setIsSigningIn] = useState(false)
  // Evita peticiones duplicadas si se pulsa "Entrar" dos veces seguidas.
  const isSigningInRef = useRef(false)
  // Descarta respuestas viejas del perfil si la sesión cambió mientras cargaba.
  const profileRequestRef = useRef(0)

  useEffect(() => {
    let isMounted = true

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!isMounted) return

        if (error) {
          console.error('[AD Clinic] No se pudo recuperar la sesión:', error.message)
        }

        setSession(data.session)
      })
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isMounted) return

      setSession(nextSession)
      setIsLoading(false)
    })

    return () => {
      isMounted = false
      authListener.subscription.unsubscribe()
    }
  }, [])

  const loadProfile = useCallback((userId: string) => {
    const requestId = ++profileRequestRef.current

    return fetchAuthProfile(userId)
      .then((nextProfile) => {
        if (requestId !== profileRequestRef.current) return

        setProfileState({ userId, profile: nextProfile })
      })
      .catch((error: unknown) => {
        if (requestId !== profileRequestRef.current) return

        // Sin la migración de perfiles no hay rol conocido: se degrada a "sin
        // permisos de administración" en lugar de romper toda la aplicación.
        console.error('[AD Clinic] No se pudo cargar el perfil:', error)
        setProfileState({ userId, profile: null })
      })
  }, [])

  const userId = session?.user?.id ?? null
  // Solo se considera válido el perfil que pertenece a la sesión activa: al
  // cerrar sesión deja de aplicarse sin necesidad de limpiar el estado.
  const activeProfile = userId && profileState?.userId === userId ? profileState.profile : null
  const isLoadingProfile = userId !== null && profileState?.userId !== userId

  useEffect(() => {
    if (!userId) return

    void loadProfile(userId)
  }, [userId, loadProfile])

  const refreshProfile = useCallback(async () => {
    if (userId) await loadProfile(userId)
  }, [userId, loadProfile])

  const signIn = useCallback(async (email: string, password: string): Promise<SignInResult> => {
    if (isSigningInRef.current) return { error: null }

    isSigningInRef.current = true
    setIsSigningIn(true)

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      return { error: error ? getAuthErrorMessage(error) : null }
    } catch (error) {
      return { error: getAuthErrorMessage(error) }
    } finally {
      isSigningInRef.current = false
      setIsSigningIn(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signOut()

      if (error) {
        // Sin conexión (o token ya revocado en el servidor): cerramos al menos
        // la sesión de este dispositivo para no dejar la PWA abierta.
        await supabase.auth.signOut({ scope: 'local' })
      }
    } catch (error) {
      console.error('[AD Clinic] Error al cerrar sesión:', error)
    } finally {
      setSession(null)
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile: activeProfile,
      role: activeProfile?.role ?? null,
      isAdmin: activeProfile?.role === 'admin' && activeProfile.is_active,
      isLoading,
      isLoadingProfile,
      isSigningIn,
      isAuthenticated: session !== null,
      refreshProfile,
      signIn,
      signOut,
    }),
    [
      session,
      activeProfile,
      isLoading,
      isLoadingProfile,
      isSigningIn,
      refreshProfile,
      signIn,
      signOut,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
