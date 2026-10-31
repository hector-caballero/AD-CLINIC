import { supabase } from '../../lib/supabase'
import { getTeamErrorMessage, toTeamError } from './team-errors'
import { TEAM_MEMBER_SELECT, type StaffRole, type TeamMember } from './team-types'

/**
 * Acceso al equipo del consultorio.
 *
 * - Lectura: `public.profiles` con RLS (un admin ve a todo el equipo).
 * - Escritura: Edge Function `team-admin`, la única que puede crear usuarios de
 *   Auth sin reemplazar la sesión del administrador que está en pantalla.
 */

/** El equipo de un consultorio es chico; este límite solo evita traer de más. */
const TEAM_PAGE_SIZE = 200

type TeamAdminResponse = {
  member?: TeamMember
  ok?: boolean
  error?: string
  warning?: string
}

export type TeamMutationResult = {
  member: TeamMember
  /** Aviso cuando el perfil se guardó pero Auth no quedó sincronizado. */
  warning: string | null
}

function asTeamMembers(data: unknown): TeamMember[] {
  return (data ?? []) as TeamMember[]
}

export async function fetchTeamMembers(): Promise<TeamMember[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select(TEAM_MEMBER_SELECT)
    .order('full_name', { ascending: true })
    .limit(TEAM_PAGE_SIZE)

  if (error) throw toTeamError(error)

  return asTeamMembers(data)
}

type FunctionsErrorLike = {
  message?: string
  context?: unknown
}

/** `functions.invoke` no expone el body del error: hay que leer `context`. */
async function readFunctionError(error: unknown): Promise<string> {
  const candidate = (error ?? {}) as FunctionsErrorLike
  const context = candidate.context

  if (context && typeof context === 'object' && 'json' in context) {
    try {
      const body = (await (context as Response).json()) as { error?: unknown }

      if (typeof body?.error === 'string' && body.error.trim()) return body.error.trim()
    } catch {
      // El cuerpo no era JSON (por ejemplo, un 502 de la plataforma).
    }
  }

  return getTeamErrorMessage(candidate.message ?? '', true)
}

async function callTeamAdmin(body: Record<string, unknown>): Promise<TeamAdminResponse> {
  const { data, error } = await supabase.functions.invoke('team-admin', { body })

  if (error) throw new Error(await readFunctionError(error))

  const result = (data ?? {}) as TeamAdminResponse

  if (result.error) throw new Error(result.error)

  return result
}

function requireMember(result: TeamAdminResponse): TeamMember {
  if (!result.member) {
    throw new Error('La operación se completó pero no se recibió el perfil actualizado.')
  }

  return result.member
}

export type CreateTeamMemberInput = {
  fullName: string
  email: string
  password: string
  role: StaffRole
}

export async function createTeamMember(input: CreateTeamMemberInput): Promise<TeamMember> {
  const result = await callTeamAdmin({
    action: 'create',
    fullName: input.fullName,
    email: input.email,
    password: input.password,
    role: input.role,
  })

  return requireMember(result)
}

export type UpdateTeamMemberInput = {
  memberId: string
  fullName: string
  role: StaffRole
  isActive: boolean
}

export async function updateTeamMember(
  input: UpdateTeamMemberInput,
): Promise<TeamMutationResult> {
  const result = await callTeamAdmin({
    action: 'update',
    memberId: input.memberId,
    fullName: input.fullName,
    role: input.role,
    isActive: input.isActive,
  })

  return { member: requireMember(result), warning: result.warning ?? null }
}

export async function resetTeamMemberPassword(
  memberId: string,
  password: string,
): Promise<void> {
  await callTeamAdmin({ action: 'reset-password', memberId, password })
}
