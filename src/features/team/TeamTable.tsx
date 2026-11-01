import { KeyRound, Loader2, Pencil, UserCheck, UserX } from 'lucide-react'
import { formatShortDate, getInitials } from '../../lib/format'
import { getMemberDisplayName, getRoleLabel, type TeamMember } from './team-types'

const HEAD_CLASS = 'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500'

const ROLE_BADGE_CLASS: Record<string, string> = {
  admin: 'bg-brand-50 text-brand-800 ring-brand-200',
  dentist: 'bg-sky-50 text-sky-700 ring-sky-200',
  receptionist: 'bg-violet-50 text-violet-700 ring-violet-200',
}

function RoleBadge({ role }: { role: TeamMember['role'] }) {
  return (
    <span
      className={[
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1',
        ROLE_BADGE_CLASS[role] ?? 'bg-slate-100 text-slate-600 ring-slate-200',
      ].join(' ')}
    >
      {getRoleLabel(role)}
    </span>
  )
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={[
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1',
        isActive
          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
          : 'bg-amber-50 text-amber-700 ring-amber-200',
      ].join(' ')}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {isActive ? 'Activo' : 'Suspendido'}
    </span>
  )
}

function MemberAvatar({ member }: { member: TeamMember }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600"
    >
      {getInitials(getMemberDisplayName(member))}
    </span>
  )
}

type MemberActionsProps = {
  member: TeamMember
  isBusy: boolean
  isSelf: boolean
  withLabels?: boolean
  onEdit: (member: TeamMember) => void
  onResetPassword: (member: TeamMember) => void
  onToggleActive: (member: TeamMember) => void
}

function MemberActions({
  member,
  isBusy,
  isSelf,
  withLabels = false,
  onEdit,
  onResetPassword,
  onToggleActive,
}: MemberActionsProps) {
  const toggleLabel = member.is_active ? 'Suspender acceso' : 'Reactivar acceso'
  const baseClass = withLabels
    ? 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white/85 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50'
    : 'rounded-lg p-2 transition-colors'

  return (
    <div className={withLabels ? 'grid grid-cols-3 gap-2' : 'flex items-center justify-end gap-1'}>
      <button
        type="button"
        onClick={() => onEdit(member)}
        aria-label={`Editar ${getMemberDisplayName(member)}`}
        title="Editar nombre y rol"
        className={`${baseClass} ${withLabels ? '' : 'text-slate-400 hover:bg-brand-50 hover:text-brand-700'}`}
      >
        <Pencil className="size-4" aria-hidden="true" />
        {withLabels && 'Editar'}
      </button>

      <button
        type="button"
        onClick={() => onResetPassword(member)}
        aria-label={`Cambiar la contraseña de ${getMemberDisplayName(member)}`}
        title="Definir nueva contraseña"
        className={`${baseClass} ${withLabels ? '' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}
      >
        <KeyRound className="size-4" aria-hidden="true" />
        {withLabels && 'Clave'}
      </button>

      <button
        type="button"
        onClick={() => onToggleActive(member)}
        disabled={isBusy || isSelf}
        aria-label={`${toggleLabel} de ${getMemberDisplayName(member)}`}
        title={isSelf ? 'No podés suspender tu propia cuenta' : toggleLabel}
        className={`${baseClass} disabled:cursor-not-allowed disabled:opacity-40 ${
          withLabels
            ? ''
            : member.is_active
              ? 'text-slate-400 hover:bg-amber-50 hover:text-amber-700'
              : 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-700'
        }`}
      >
        {isBusy ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : member.is_active ? (
          <UserX className="size-4" aria-hidden="true" />
        ) : (
          <UserCheck className="size-4" aria-hidden="true" />
        )}
        {withLabels && (member.is_active ? 'Suspender' : 'Reactivar')}
      </button>
    </div>
  )
}

type TeamTableProps = {
  members: TeamMember[]
  currentUserId: string | null
  pendingId: string | null
  onEdit: (member: TeamMember) => void
  onResetPassword: (member: TeamMember) => void
  onToggleActive: (member: TeamMember) => void
}

/**
 * Listado del equipo: tabla en `md+` y tarjetas en móvil.
 * Los usuarios suspendidos se atenúan y no pueden iniciar sesión.
 */
export function TeamTable({
  members,
  currentUserId,
  pendingId,
  onEdit,
  onResetPassword,
  onToggleActive,
}: TeamTableProps) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left">
          <caption className="sr-only">Usuarios con acceso a AD Clinic</caption>
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className={HEAD_CLASS}>
                Usuario
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Rol
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Acceso
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Alta
              </th>
              <th scope="col" className={`text-right ${HEAD_CLASS}`}>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {members.map((member) => {
              const isSelf = member.id === currentUserId

              return (
                <tr
                  key={member.id}
                  className={[
                    'border-b border-slate-100 transition-colors hover:bg-slate-50/70',
                    member.is_active ? '' : 'opacity-60',
                  ].join(' ')}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <MemberAvatar member={member} />
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                          <span className="truncate">{getMemberDisplayName(member)}</span>
                          {isSelf && (
                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                              Vos
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-slate-500">{member.email ?? '—'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <RoleBadge role={member.role} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <StatusBadge isActive={member.is_active} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {formatShortDate(member.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <MemberActions
                      member={member}
                      isBusy={pendingId === member.id}
                      isSelf={isSelf}
                      onEdit={onEdit}
                      onResetPassword={onResetPassword}
                      onToggleActive={onToggleActive}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-slate-100 md:hidden">
        {members.map((member) => {
          const isSelf = member.id === currentUserId

          return (
            <li
              key={member.id}
              className={`space-y-3 px-4 py-4 ${member.is_active ? '' : 'opacity-60'}`}
            >
              <div className="flex items-start gap-3">
                <MemberAvatar member={member} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                    <span className="truncate">{getMemberDisplayName(member)}</span>
                    {isSelf && (
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                        Vos
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500">{member.email ?? '—'}</p>
                </div>
                <StatusBadge isActive={member.is_active} />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <RoleBadge role={member.role} />
                <span className="text-xs text-slate-500">
                  Alta {formatShortDate(member.created_at)}
                </span>
              </div>

              <MemberActions
                member={member}
                isBusy={pendingId === member.id}
                isSelf={isSelf}
                withLabels
                onEdit={onEdit}
                onResetPassword={onResetPassword}
                onToggleActive={onToggleActive}
              />
            </li>
          )
        })}
      </ul>

    </>
  )
}
