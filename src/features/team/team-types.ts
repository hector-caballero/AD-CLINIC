/**
 * Tipos y utilidades del equipo del consultorio (`public.profiles`).
 *
 * Reglas del módulo:
 * - Cada fila de `profiles` es un usuario de Supabase Auth (`id` compartido).
 * - Los roles son fijos: `admin` gestiona el equipo, `dentist` atiende y
 *   `receptionist` agenda y cobra.
 * - El alta, la edición y el cambio de contraseña pasan por la Edge Function
 *   `team-admin`: el cliente no puede crear usuarios sin perder su sesión.
 * - Nunca se borra un usuario desde la app: se suspende (`is_active = false`),
 *   lo que además bloquea el login en Supabase Auth.
 */

export type StaffRole = 'admin' | 'dentist' | 'receptionist'

export type TeamMember = {
  /** Mismo id que `auth.users`. */
  id: string
  full_name: string
  email: string | null
  role: StaffRole
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Columnas que devuelve PostgREST y la Edge Function `team-admin`. */
export const TEAM_MEMBER_SELECT = 'id, full_name, email, role, is_active, created_at, updated_at'

export type StaffRoleOption = {
  value: StaffRole
  label: string
  /** Alcance del rol, se muestra como ayuda en el formulario. */
  description: string
}

export const STAFF_ROLE_OPTIONS: StaffRoleOption[] = [
  {
    value: 'admin',
    label: 'Administración',
    description: 'Gestiona el equipo, el catálogo de tratamientos y la caja.',
  },
  {
    value: 'dentist',
    label: 'Odontología',
    description: 'Atiende las citas y registra los tratamientos realizados.',
  },
  {
    value: 'receptionist',
    label: 'Recepción',
    description: 'Agenda citas, registra pacientes y carga cobros.',
  },
]

export type TeamRoleFilter = 'all' | StaffRole

export const TEAM_ROLE_FILTERS: { value: TeamRoleFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'admin', label: 'Administración' },
  { value: 'dentist', label: 'Odontología' },
  { value: 'receptionist', label: 'Recepción' },
]

export type TeamFilters = {
  query: string
  role: TeamRoleFilter
}

export type TeamMemberFormValues = {
  full_name: string
  email: string
  role: StaffRole
  /** Solo en el alta: la contraseña inicial que se comparte con la persona. */
  password: string
  is_active: boolean
}

export type TeamSummary = {
  total: number
  active: number
  admins: number
  dentists: number
  receptionists: number
}

/** Nombre visible del miembro, con el email como respaldo. */
export function getMemberDisplayName(member: {
  full_name?: string | null
  email?: string | null
}): string {
  const name = member.full_name?.trim()

  if (name) return name

  const email = member.email?.trim()

  return email ? email.split('@')[0] : 'Sin nombre'
}

export function getRoleLabel(role: string | null | undefined): string {
  return STAFF_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? 'Sin rol'
}

export function isStaffRole(value: unknown): value is StaffRole {
  return (
    typeof value === 'string' && STAFF_ROLE_OPTIONS.some((option) => option.value === value)
  )
}

function getRoleRank(role: StaffRole): number {
  return STAFF_ROLE_OPTIONS.findIndex((option) => option.value === role)
}

/** Orden del equipo: activos primero, luego por rol y nombre. */
export function compareTeamMembers(a: TeamMember, b: TeamMember): number {
  if (a.is_active !== b.is_active) return a.is_active ? -1 : 1

  const byRole = getRoleRank(a.role) - getRoleRank(b.role)

  if (byRole !== 0) return byRole

  return getMemberDisplayName(a).localeCompare(getMemberDisplayName(b), 'es', {
    sensitivity: 'base',
  })
}

/** Minúsculas y sin diacríticos, para buscar sin importar tildes. */
function normalize(value: string): string {
  return value
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

export function filterTeamMembers(
  members: TeamMember[],
  { query, role }: TeamFilters,
): TeamMember[] {
  const term = normalize(query)

  return members.filter((member) => {
    if (role !== 'all' && member.role !== role) return false
    if (!term) return true

    const haystack = normalize(
      [member.full_name, member.email ?? '', getRoleLabel(member.role)].join(' '),
    )

    return haystack.includes(term)
  })
}

export function countTeamByRole(members: TeamMember[]): Record<TeamRoleFilter, number> {
  return {
    all: members.length,
    admin: members.filter((member) => member.role === 'admin').length,
    dentist: members.filter((member) => member.role === 'dentist').length,
    receptionist: members.filter((member) => member.role === 'receptionist').length,
  }
}

export function computeTeamSummary(members: TeamMember[]): TeamSummary {
  const counts = countTeamByRole(members)

  return {
    total: members.length,
    active: members.filter((member) => member.is_active).length,
    admins: counts.admin,
    dentists: counts.dentist,
    receptionists: counts.receptionist,
  }
}

/**
 * `true` si el cambio dejaría al consultorio sin administradores activos.
 * Sirve para deshabilitar la acción antes de que la base la rechace.
 */
export function wouldRemoveLastAdmin(
  members: TeamMember[],
  member: TeamMember,
  next: { role?: StaffRole; is_active?: boolean },
): boolean {
  if (member.role !== 'admin' || !member.is_active) return false

  const nextRole = next.role ?? member.role
  const nextIsActive = next.is_active ?? member.is_active

  if (nextRole === 'admin' && nextIsActive) return false

  return !members.some(
    (candidate) =>
      candidate.id !== member.id && candidate.role === 'admin' && candidate.is_active,
  )
}
