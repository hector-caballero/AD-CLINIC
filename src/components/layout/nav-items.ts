import {
  CalendarDays,
  LayoutDashboard,
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
    to: '/caja',
    label: 'Caja',
    description: 'Cobros, pagos y saldos',
    icon: Wallet,
  },
]

/** Sección activa según la ruta actual (para el título del header). */
export function findNavItem(pathname: string): NavItem | undefined {
  const matches = navItems.filter((item) =>
    item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`),
  )

  return matches.sort((a, b) => b.to.length - a.to.length)[0]
}
