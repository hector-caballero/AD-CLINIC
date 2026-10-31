import { useCallback, useMemo, useState } from 'react'
import {
  AlertCircle,
  Loader2,
  RefreshCw,
  SearchX,
  ShieldCheck,
  Stethoscope,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '../features/auth/AuthContext'
import { TeamMemberFormModal } from '../features/team/TeamMemberFormModal'
import { TeamPasswordModal } from '../features/team/TeamPasswordModal'
import { TeamTable } from '../features/team/TeamTable'
import { TeamToolbar } from '../features/team/TeamToolbar'
import {
  computeTeamSummary,
  countTeamByRole,
  filterTeamMembers,
  wouldRemoveLastAdmin,
  type TeamMember,
  type TeamRoleFilter,
} from '../features/team/team-types'
import { updateTeamMember } from '../features/team/team-service'
import { useTeamMembers } from '../features/team/useTeamMembers'

type FormState = { mode: 'create' } | { mode: 'edit'; member: TeamMember } | null

type Notice = { tone: 'success' | 'warning' | 'error'; message: string }

const PRIMARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700'

const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50'

const NOTICE_CLASS: Record<Notice['tone'], string> = {
  success: 'border-emerald-100 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-100 bg-amber-50 text-amber-800',
  error: 'border-red-100 bg-red-50 text-red-700',
}

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string
  value: string
  detail: string
  icon: typeof Users
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-slate-500">
        <Icon className="size-4" aria-hidden="true" />
        <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
        {value}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{detail}</p>
    </div>
  )
}

/**
 * Equipo y roles (solo administración).
 *
 * El alta de usuarios y el reset de contraseña pasan por la Edge Function
 * `team-admin`; los cambios de nombre, rol y estado también, para que Supabase
 * Auth y `profiles` no se desincronicen.
 */
export default function TeamPage() {
  const { user, refreshProfile } = useAuth()
  const { members, isLoading, error, reload, addMember, replaceMember } = useTeamMembers()

  const [query, setQuery] = useState('')
  const [role, setRole] = useState<TeamRoleFilter>('all')
  const [formState, setFormState] = useState<FormState>(null)
  const [passwordTarget, setPasswordTarget] = useState<TeamMember | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const currentUserId = user?.id ?? null
  const summary = useMemo(() => computeTeamSummary(members), [members])
  const roleCounts = useMemo(() => countTeamByRole(members), [members])
  const visibleMembers = useMemo(
    () => filterTeamMembers(members, { query, role }),
    [members, query, role],
  )

  const hasFilters = query.trim().length > 0 || role !== 'all'

  const clearFilters = useCallback(() => {
    setQuery('')
    setRole('all')
  }, [])

  function openCreate() {
    setNotice(null)
    setFormState({ mode: 'create' })
  }

  function openEdit(member: TeamMember) {
    setNotice(null)
    setFormState({ mode: 'edit', member })
  }

  function closeForm() {
    setFormState(null)
  }

  function handleSaved(member: TeamMember, mode: 'create' | 'edit', warning: string | null) {
    if (mode === 'create') {
      addMember(member)
      setNotice({
        tone: 'success',
        message: `${member.full_name} ya puede iniciar sesión con ${member.email ?? 'su correo'}.`,
      })
    } else {
      replaceMember(member)
      setNotice({ tone: 'success', message: `Se actualizó el perfil de ${member.full_name}.` })
    }

    if (warning) setNotice({ tone: 'warning', message: warning })

    // Si el admin editó su propio perfil, el layout debe reflejar el cambio.
    if (member.id === currentUserId) void refreshProfile()

    setFormState(null)
  }

  async function handleToggleActive(member: TeamMember) {
    if (pendingId) return

    const nextIsActive = !member.is_active

    if (wouldRemoveLastAdmin(members, member, { is_active: nextIsActive })) {
      setNotice({
        tone: 'error',
        message:
          'No podés suspender al único administrador activo. Asigná ese rol a otra persona primero.',
      })
      return
    }

    setPendingId(member.id)
    setNotice(null)

    try {
      const result = await updateTeamMember({
        memberId: member.id,
        fullName: member.full_name,
        role: member.role,
        isActive: nextIsActive,
      })

      replaceMember(result.member)
      setNotice({
        tone: result.warning ? 'warning' : 'success',
        message:
          result.warning ??
          (nextIsActive
            ? `${result.member.full_name} recuperó el acceso al sistema.`
            : `${result.member.full_name} quedó suspendido y ya no puede iniciar sesión.`),
      })
    } catch (cause) {
      setNotice({
        tone: 'error',
        message:
          cause instanceof Error
            ? cause.message
            : 'No se pudo cambiar el acceso del usuario. Intentá de nuevo.',
      })
    } finally {
      setPendingId(null)
    }
  }

  function handlePasswordChanged(member: TeamMember) {
    setPasswordTarget(null)
    setNotice({
      tone: 'success',
      message: `Se actualizó la contraseña de ${member.full_name}. Compartila por un canal seguro.`,
    })
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Equipo"
          value={String(summary.total)}
          detail={`${summary.active} con acceso habilitado`}
          icon={Users}
        />
        <SummaryCard
          label="Administración"
          value={String(summary.admins)}
          detail="Gestionan equipo, catálogo y caja"
          icon={ShieldCheck}
        />
        <SummaryCard
          label="Odontología"
          value={String(summary.dentists)}
          detail="Atienden las citas de la agenda"
          icon={Stethoscope}
        />
        <SummaryCard
          label="Recepción"
          value={String(summary.receptionists)}
          detail="Agendan citas y registran cobros"
          icon={Users}
        />
      </div>

      <section
        aria-label="Usuarios del consultorio"
        aria-busy={isLoading}
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      >
        <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
          <TeamToolbar
            query={query}
            role={role}
            roleCounts={roleCounts}
            onQueryChange={setQuery}
            onRoleChange={setRole}
            onCreate={openCreate}
          />
        </div>

        {notice && (
          <div
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={`flex items-center justify-between gap-3 border-b px-4 py-2.5 text-sm sm:px-5 ${NOTICE_CLASS[notice.tone]}`}
          >
            <span>{notice.message}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Ocultar aviso"
              className="rounded-md p-1 transition-colors hover:bg-black/5"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {error ? (
          <div role="alert" className="flex flex-col items-center px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
              <AlertCircle className="size-7" aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-sm font-semibold text-slate-900">
              No pudimos cargar el equipo
            </h2>
            <p className="mt-1 max-w-md text-sm leading-relaxed text-slate-500">{error}</p>
            <button type="button" onClick={reload} className={`mt-5 ${PRIMARY_BUTTON_CLASS}`}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Reintentar
            </button>
          </div>
        ) : isLoading ? (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-3 px-6 py-20 text-center"
          >
            <Loader2 className="size-6 animate-spin text-brand-600" aria-hidden="true" />
            <p className="text-sm text-slate-500">Cargando equipo…</p>
          </div>
        ) : visibleMembers.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <SearchX className="size-7" aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-sm font-semibold text-slate-900">
              {hasFilters ? 'Sin resultados para estos filtros' : 'Todavía no hay usuarios'}
            </h2>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
              {hasFilters
                ? 'No encontramos usuarios con ese nombre, correo o rol. Probá con otro criterio.'
                : 'Creá la primera cuenta del equipo para que puedan iniciar sesión.'}
            </p>
            {hasFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className={`mt-5 ${SECONDARY_BUTTON_CLASS}`}
              >
                Limpiar filtros
              </button>
            ) : (
              <button type="button" onClick={openCreate} className={`mt-5 ${PRIMARY_BUTTON_CLASS}`}>
                <Users className="size-4" aria-hidden="true" />
                Nuevo usuario
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500 sm:px-5">
              <span>
                Mostrando{' '}
                <span className="font-semibold text-slate-700">{visibleMembers.length}</span> de{' '}
                {members.length} usuarios
              </span>
              {hasFilters && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="font-medium text-brand-700 transition-colors hover:text-brand-800 hover:underline"
                >
                  Limpiar filtros
                </button>
              )}
            </div>

            <TeamTable
              members={visibleMembers}
              currentUserId={currentUserId}
              pendingId={pendingId}
              onEdit={openEdit}
              onResetPassword={setPasswordTarget}
              onToggleActive={handleToggleActive}
            />
          </>
        )}

      </section>

      <p className="text-xs leading-relaxed text-slate-400">
        Los usuarios no se eliminan: al suspenderlos pierden el acceso pero se conserva el
        historial de citas y cobros que registraron. El alta y las contraseñas se gestionan con la
        función segura <code className="font-mono text-[11px]">team-admin</code>.
      </p>

      {formState && (
        <TeamMemberFormModal
          key={formState.mode === 'edit' ? formState.member.id : 'new-member'}
          member={formState.mode === 'edit' ? formState.member : null}
          currentUserId={currentUserId}
          onClose={closeForm}
          onSaved={handleSaved}
        />
      )}

      {passwordTarget && (
        <TeamPasswordModal
          key={passwordTarget.id}
          member={passwordTarget}
          onClose={() => setPasswordTarget(null)}
          onDone={handlePasswordChanged}
        />
      )}
    </div>
  )
}
