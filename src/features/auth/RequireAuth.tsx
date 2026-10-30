import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { FullScreenLoader } from '../../components/ui/FullScreenLoader'
import { useAuth } from './AuthContext'

/**
 * Guard de rutas: exige sesión activa.
 * Mientras se resuelve la sesión persistida muestra un loader (evita el
 * "parpadeo" hacia /login al recargar la PWA).
 */
export function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return <FullScreenLoader label="Comprobando tu sesión…" />

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}
