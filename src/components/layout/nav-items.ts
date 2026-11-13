import {
  CalendarDays,
  ClipboardList,
  FileText,
  LayoutDashboard,
  ShieldCheck,
  Stethoscope,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

export type NavItem = {
  to: string
  label: string
  /** Texto corto que se muestra bajo el título de la sección. */
  description: string
  icon: LucideIcon
  /** `true` para que la ruta solo se marque como activa en coincidencia exacta. */
  end?: boolean
  /** Solo visible para usuarios con rol `admin`. */
  adminOnly?: boolean
}

export const navItems: NavItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    description: 'Resumen del día',
    icon: LayoutDashboard,
    end: true,
  },
  {
    to: '/pacientes',
    label: 'Pacientes',
    description: 'Fichas e historiales',
    icon: Users,
  },
  {
    to: '/citas',
    label: 'Citas',
    description: 'Agenda de la clínica',
    icon: CalendarDays,
  },
  {
    to: '/tratamientos',
    label: 'Tratamientos',
    description: 'Catálogo y planes',
    icon: Stethoscope,
  },
  {
    to: '/odontograma',
    label: 'Odontograma',
    description: 'Mapa dental y presupuesto',
    icon: ClipboardList,
  },
  {
    to: '/caja',
    label: 'Caja',
    description: 'Cobros, pagos y saldos',
    icon: Wallet,
  },
  {
    to: '/facturacion',
    label: 'Facturación',
    description: 'Facturas legales y gastos',
    icon: FileText,
  },
  {
    to: '/equipo',
    label: 'Equipo',
    description: 'Usuarios y roles',
    icon: ShieldCheck,
    adminOnly: true,
  },
]

/**
 * Ítems que puede ver el usuario según su rol.
 * Los `adminOnly` solo aparecen para administración (la ruta igual está
 * protegida con `<RequireAdmin>`, esto es solo la navegación).
 */
export function getNavItems(isAdmin: boolean): NavItem[] {
  return isAdmin ? navItems : navItems.filter((item) => !item.adminOnly)
}

/** Sección activa según la ruta actual (para el título del header). */
export function findNavItem(pathname: string): NavItem | undefined {
  const matches = navItems.filter((item) =>
    item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`),
  )

  return matches.sort((a, b) => b.to.length - a.to.length)[0]
}
