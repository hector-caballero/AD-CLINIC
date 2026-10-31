import type { ReactNode } from 'react'
import { Navigate, Outlet, Link, useLocation } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { FullScreenLoader } from '../../components/ui/FullScreenLoader'
import { useAuth } from './AuthContext'

type RequireAdminProps = {
  /** Contenido a renderizar; si se omite se usa el `<Outlet />` de la ruta. */
  children?: ReactNode
}

/**
 * Guard de rutas exclusivas de administración.
 *
 * La sesión ya la valida `<RequireAuth>`; acá se espera el perfil
 * (`public.profiles`) para conocer el rol. Si la persona no es administradora
 * se muestra una pantalla de acceso restringido: redirigir en silencio al
 * dashboard confunde más que explicar el motivo.
 */
export function RequireAdmin({ children }: RequireAdminProps) {
  const { isAuthenticated, isLoading, isAdmin, isLoadingProfile } = useAuth()
  const location = useLocation()

  if (isLoading) return <FullScreenLoader label="Comprobando tu sesión…" />

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (isLoadingProfile) return <FullScreenLoader label="Cargando tus permisos…" />

  if (!isAdmin) return <AccessDenied />

  return children ?? <Outlet />
}

function AccessDenied() {
  return (
    <section className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <span
        aria-hidden="true"
        className="mx-auto flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-600"
      >
        <ShieldAlert className="size-6" />
      </span>
      <h1 className="mt-4 text-lg font-semibold tracking-tight text-slate-900">
        Acceso restringido
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-500">
        Esta sección es solo para administración. Si necesitás gestionar el equipo, pedile a una
        persona con rol de administración que te lo habilite.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
      >
        Volver al dashboard
      </Link>
    </section>
  )
}
