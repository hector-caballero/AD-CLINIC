import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, KeyRound, Loader2, WifiOff } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { resetTeamMemberPassword } from './team-service'
import { getMemberDisplayName, type TeamMember } from './team-types'

const MIN_PASSWORD_LENGTH = 8

type PasswordErrors = {
  password?: string
  confirmation?: string
}

type TeamPasswordModalProps = {
  member: TeamMember
  onClose: () => void
  onDone: (member: TeamMember) => void
}

function inputClass(hasError: boolean): string {
  return [
    'w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400',
    hasError ? 'border-red-300' : 'border-slate-300 focus:border-brand-500',
  ].join(' ')
}

/**
 * Asigna una contraseña nueva a un usuario del equipo.
 *
 * La contraseña la define el administrador (no se envía un correo de
 * recuperación), así que la cuenta queda operativa al instante y el cambio se
 * comunica en persona o por un canal seguro.
 */
export function TeamPasswordModal({ member, onClose, onDone }: TeamPasswordModalProps) {
  const isOnline = useOnlineStatus()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [errors, setErrors] = useState<PasswordErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const displayName = getMemberDisplayName(member)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isSaving) return

    const nextErrors: PasswordErrors = {}

    if (!password) {
      nextErrors.password = 'Ingresá la contraseña nueva.'
    } else if (password.length < MIN_PASSWORD_LENGTH) {
      nextErrors.password = `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`
    }

    if (password && confirmation !== password) {
      nextErrors.confirmation = 'Las contraseñas no coinciden.'
    }

    setErrors(nextErrors)
    setFormError(null)

    if (nextErrors.password || nextErrors.confirmation) {
      document
        .getElementById(nextErrors.password ? 'team-password-new' : 'team-password-confirm')
        ?.focus()
      return
    }

    if (!isOnline) {
      setFormError('Sin conexión: no se puede cambiar la contraseña. Revisá tu internet.')
      return
    }

    setIsSaving(true)

    try {
      await resetTeamMemberPassword(member.id, password)
      onDone(member)
    } catch (cause) {
      setFormError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo cambiar la contraseña. Intentá de nuevo.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      title="Cambiar contraseña"
      description={`Definí una contraseña nueva para ${displayName} (${member.email ?? 'sin correo'}).`}
      onClose={onClose}
      isBusy={isSaving}
      size="sm"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="team-password-form"
            disabled={isSaving || !isOnline}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound className="size-4" aria-hidden="true" />
            )}
            {isSaving ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
        </div>
      }
    >
      <form id="team-password-form" onSubmit={handleSubmit} noValidate className="space-y-4">
        {formError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
          >
            {!isOnline && <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
            <span>{formError}</span>
          </div>
        )}

        <div>
          <label htmlFor="team-password-new" className="block text-sm font-medium text-slate-700">
            Contraseña nueva
          </label>
          <div className="relative mt-1.5">
            <input
              id="team-password-new"
              type={isPasswordVisible ? 'text' : 'password'}
              value={password}
              autoComplete="new-password"
              data-autofocus
              onChange={(event) => {
                setPassword(event.target.value)
                setErrors((current) => ({ ...current, password: undefined }))
              }}
              placeholder="••••••••"
              className={`${inputClass(Boolean(errors.password))} pr-11`}
              aria-invalid={Boolean(errors.password)}
            />
            <button
              type="button"
              onClick={() => setIsPasswordVisible((visible) => !visible)}
              aria-label={isPasswordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              {isPasswordVisible ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
          {errors.password && (
            <p className="mt-1 text-xs font-medium text-red-600">{errors.password}</p>
          )}
        </div>

        <div>
          <label
            htmlFor="team-password-confirm"
            className="block text-sm font-medium text-slate-700"
          >
            Repetir contraseña
          </label>
          <input
            id="team-password-confirm"
            type={isPasswordVisible ? 'text' : 'password'}
            value={confirmation}
            autoComplete="new-password"
            onChange={(event) => {
              setConfirmation(event.target.value)
              setErrors((current) => ({ ...current, confirmation: undefined }))
            }}
            placeholder="••••••••"
            className={`mt-1.5 ${inputClass(Boolean(errors.confirmation))}`}
            aria-invalid={Boolean(errors.confirmation)}
          />
          {errors.confirmation && (
            <p className="mt-1 text-xs font-medium text-red-600">{errors.confirmation}</p>
          )}
        </div>

        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          La persona puede seguir usando la sesión abierta, pero necesitará la contraseña nueva en
          el próximo inicio de sesión. Compartila por un canal seguro.
        </p>

      </form>
    </Modal>
  )
}
