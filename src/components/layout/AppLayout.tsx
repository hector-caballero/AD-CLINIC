import { useEffect, useState } from 'react'
import { LogOut, Menu, X } from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthContext'
import { getRoleLabel } from '../../features/team/team-types'
import { getInitials } from '../../lib/format'
import { Brand } from './Brand'
import { ConnectionStatus } from './ConnectionStatus'
import { findNavItem, getNavItems, type NavItem } from './nav-items'

type NavItemLinkProps = {
  item: NavItem
  onNavigate?: () => void
}

function NavItemLink({ item, onNavigate }: NavItemLinkProps) {
  const Icon = item.icon

  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        [
          'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
          isActive
            ? 'bg-brand-50 text-brand-900 ring-1 ring-brand-200'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={`size-5 shrink-0 ${
              isActive ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-600'
            }`}
            aria-hidden="true"
          />
          <span className="truncate">{item.label}</span>
        </>
      )}
    </NavLink>
  )
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto px-3 py-4">
      <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
        Clínica
      </p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.to}>
            <NavItemLink item={item} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </nav>
  )
}

type UserCardProps = {
  name: string
  subtitle: string
  onSignOut: () => void
}

function UserCard({ name, subtitle, onSignOut }: UserCardProps) {
  return (
    <div className="shrink-0 border-t border-slate-200 p-3">
      <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white"
        >
          {getInitials(name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {subtitle}
          </p>
          <p className="truncate text-sm font-medium text-slate-900">{name}</p>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          title="Cerrar sesión"
          aria-label="Cerrar sesión"
          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white hover:text-red-600"
        >
          <LogOut className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

/**
 * Layout principal autenticado.
 *
 * - `lg+`: sidebar fija a la izquierda.
 * - móvil/tablet: drawer deslizante con backdrop, cierre con Escape y bloqueo
 *   del scroll de fondo (imprescindible en una PWA instalada).
 */
export function AppLayout() {
  const { user, profile, role, isAdmin, signOut } = useAuth()
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  const email = user?.email ?? ''
  const displayName = profile?.full_name?.trim() || email || 'Usuario'
  const userSubtitle = profile
    ? `${getRoleLabel(role)} · ${email || 'sin correo'}`
    : 'Sesión iniciada'
  const navListItems = getNavItems(isAdmin)
  const currentSection = findNavItem(location.pathname)

  // Cierra el drawer con Escape o al navegar con el botón "atrás" del móvil.
  // (`overflow: hidden` se restaura siempre en el cleanup.)
  useEffect(() => {
    if (!isDrawerOpen) return

    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'

    const closeDrawer = () => setIsDrawerOpen(false)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('popstate', closeDrawer)

    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('popstate', closeDrawer)
    }
  }, [isDrawerOpen])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-svh bg-slate-50 lg:grid lg:grid-cols-[18rem_1fr]">
      {/* Sidebar de escritorio */}
      <aside className="hidden border-r border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-svh lg:flex-col">
        <div className="flex h-16 shrink-0 items-center border-b border-slate-200 px-5">
          <Brand />
        </div>
        <NavList items={navListItems} />
        <UserCard name={displayName} subtitle={userSubtitle} onSignOut={handleSignOut} />
      </aside>

      {/* Drawer de móvil / tablet */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Cerrar menú"
            onClick={() => setIsDrawerOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-slate-900/50 backdrop-blur-sm"
          />
          <div
            id="mobile-nav"
            role="dialog"
            aria-modal="true"
            aria-label="Menú de navegación"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl"
          >
            <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4">
              <Brand />
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                aria-label="Cerrar menú"
                className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>
            <NavList items={navListItems} onNavigate={() => setIsDrawerOpen(false)} />
            <UserCard name={displayName} subtitle={userSubtitle} onSignOut={handleSignOut} />
          </div>
        </div>
      )}

      {/* Columna de contenido */}
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-slate-200 bg-white/90 px-4 backdrop-blur-md lg:gap-3 lg:px-8">
          <button
            type="button"
            onClick={() => setIsDrawerOpen(true)}
            aria-label="Abrir menú"
            aria-controls="mobile-nav"
            aria-expanded={isDrawerOpen}
            aria-haspopup="dialog"
            className="-ml-1 rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 lg:hidden"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
              {currentSection?.label ?? 'AD Clinic'}
            </h1>
            <p className="hidden truncate text-xs text-slate-500 sm:block">
              {currentSection?.description ?? 'Gestión de la clínica dental'}
            </p>
          </div>

          <ConnectionStatus />

          <div className="hidden items-center gap-2 border-l border-slate-200 pl-3 sm:flex">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11px] font-semibold text-white"
            >
              {getInitials(email)}
            </span>
            <span className="max-w-40 truncate text-sm text-slate-600">{email}</span>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <LogOut className="size-5" aria-hidden="true" />
          </button>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>

        <footer className="border-t border-slate-200 px-4 py-4 text-center text-xs text-slate-400 lg:px-8">
          AD Clinic · Gestión odontológica
        </footer>
      </div>
    </div>
  )
}
