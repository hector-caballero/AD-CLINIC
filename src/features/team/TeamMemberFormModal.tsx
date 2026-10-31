import { useState, type FormEvent, type ReactNode } from 'react'
import { Eye, EyeOff, Loader2, Save, UserPlus, WifiOff } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { createTeamMember, updateTeamMember } from './team-service'
import {
  STAFF_ROLE_OPTIONS,
  getMemberDisplayName,
  type StaffRole,
  type TeamMember,
  type TeamMemberFormValues,
} from './team-types'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const MIN_PASSWORD_LENGTH = 8

const EMPTY_FORM: TeamMemberFormValues = {
  full_name: '',
  email: '',
  role: 'receptionist',
  password: '',
  is_active: true,
}

type FormErrors = Partial<Record<keyof TeamMemberFormValues, string>>

function inputClass(hasError: boolean): string {
  return [
    'w-full rounded-xl border bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400',
    hasError ? 'border-red-300' : 'border-slate-300 focus:border-brand-500',
  ].join(' ')
}

function toFormValues(member: TeamMember | null): TeamMemberFormValues {
  if (!member) return EMPTY_FORM

  return {
    full_name: member.full_name,
    email: member.email ?? '',
    role: member.role,
    password: '',
    is_active: member.is_active,
  }
}

function validate(values: TeamMemberFormValues, isEditing: boolean): FormErrors {
  const errors: FormErrors = {}
  const name = values.full_name.trim()

  if (!name) {
    errors.full_name = 'Ingresá el nombre y apellido.'
  } else if (name.length < 3) {
    errors.full_name = 'El nombre debe tener al menos 3 caracteres.'
  }

  if (isEditing) return errors

  const email = values.email.trim()

  if (!email) {
    errors.email = 'Ingresá el correo con el que va a iniciar sesión.'
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = 'El correo no tiene un formato válido.'
  }

  if (!values.password) {
    errors.password = 'Definí una contraseña inicial.'
  } else if (values.password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`
  }

  return errors
}

type FieldProps = {
  id: string
  label: string
  error?: string
  hint?: string
  required?: boolean
  className?: string
  children: ReactNode
}

function Field({ id, label, error, hint, required, className = '', children }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
        {required && (
          <>
            <span aria-hidden="true" className="ml-0.5 text-red-500">
              *
            </span>
            <span className="sr-only"> (obligatorio)</span>
          </>
        )}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-400">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

type TeamMemberFormModalProps = {
  member: TeamMember | null
  currentUserId: string | null
  onClose: () => void
  onSaved: (member: TeamMember, mode: 'create' | 'edit', warning: string | null) => void
}

/**
 * Alta y edición de usuarios del consultorio.
 *
 * El alta crea la cuenta en Supabase Auth mediante la Edge Function
 * `team-admin` (el cliente no puede hacerlo sin cerrar la sesión del admin).
 * La edición solo cambia nombre, rol y estado: el correo queda fijo porque es
 * la identidad de login.
 */
export function TeamMemberFormModal({
  member,
  currentUserId,
  onClose,
  onSaved,
}: TeamMemberFormModalProps) {
  const isOnline = useOnlineStatus()
  const [values, setValues] = useState<TeamMemberFormValues>(() => toFormValues(member))
  const [errors, setErrors] = useState<FormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const isEditing = Boolean(member)
  const isSelf = Boolean(member && member.id === currentUserId)

  const selectedRole = STAFF_ROLE_OPTIONS.find((option) => option.value === values.role)

  function clearError(field: keyof TeamMemberFormValues) {
    setErrors((current) => {
      if (!(field in current)) return current

      const next = { ...current }
      delete next[field]

      return next
    })
  }

  function setField<K extends keyof TeamMemberFormValues>(
    field: K,
    value: TeamMemberFormValues[K],
  ) {
    setValues((current) => ({ ...current, [field]: value }))
    clearError(field)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isSaving) return

    const validation = validate(values, isEditing)
    setErrors(validation)
    setFormError(null)

    const firstError = Object.keys(validation)[0]

    if (firstError) {
      setFormError('Revisá los campos marcados para poder guardar.')
      document.getElementById(`team-${firstError.replace('_', '-')}`)?.focus()
      return
    }

    if (!isOnline) {
      setFormError('Sin conexión: no se puede guardar el usuario. Revisá tu internet.')
      return
    }

    setIsSaving(true)

    try {
      if (isEditing && member) {
        const result = await updateTeamMember({
          memberId: member.id,
          fullName: values.full_name.trim(),
          role: values.role as StaffRole,
          isActive: values.is_active,
        })

        onSaved(result.member, 'edit', result.warning)
        return
      }

      const created = await createTeamMember({
        fullName: values.full_name.trim(),
        email: values.email.trim().toLowerCase(),
        password: values.password,
        role: values.role as StaffRole,
      })

      onSaved(created, 'create', null)
    } catch (cause) {
      setFormError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo guardar el usuario. Intentá de nuevo.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      title={isEditing && member ? `Editar ${getMemberDisplayName(member)}` : 'Nuevo usuario'}
      description={
        isEditing
          ? 'Actualizá el nombre, el rol o el acceso al sistema.'
          : 'Se crea la cuenta con la contraseña que definas acá. Compartila con la persona por un canal seguro.'
      }
      onClose={onClose}
      isBusy={isSaving}
      size="md"
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
            form="team-form"
            disabled={isSaving || !isOnline}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : isEditing ? (
              <Save className="size-4" aria-hidden="true" />
            ) : (
              <UserPlus className="size-4" aria-hidden="true" />
            )}
            {isSaving ? 'Guardando…' : isEditing ? 'Guardar cambios' : 'Crear usuario'}
          </button>
        </div>
      }
    >
      <form id="team-form" onSubmit={handleSubmit} noValidate className="space-y-5">
        {formError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
          >
            {!isOnline && <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
            <span>{formError}</span>
          </div>
        )}

        <Field
          id="team-full_name"
          label="Nombre y apellido"
          required
          error={errors.full_name}
          hint="Así aparece en la agenda y en los registros de caja."
        >
          <input
            id="team-full_name"
            type="text"
            value={values.full_name}
            maxLength={120}
            autoComplete="off"
            data-autofocus
            onChange={(event) => setField('full_name', event.target.value)}
            placeholder="Ej.: Dra. Ana Benítez"
            className={inputClass(Boolean(errors.full_name))}
            aria-invalid={Boolean(errors.full_name)}
          />
        </Field>

        <Field
          id="team-email"
          label="Correo electrónico"
          required={!isEditing}
          error={errors.email}
          hint={isEditing ? 'El correo de acceso no se puede cambiar desde acá.' : undefined}
        >
          <input
            id="team-email"
            type="email"
            value={values.email}
            readOnly={isEditing}
            autoComplete="off"
            inputMode="email"
            onChange={(event) => setField('email', event.target.value)}
            placeholder="ana@clinica.com.py"
            className={`${inputClass(Boolean(errors.email))} ${isEditing ? 'bg-slate-50 text-slate-500' : ''}`}
            aria-invalid={Boolean(errors.email)}
          />
        </Field>

        <Field
          id="team-role"
          label="Rol"
          required
          error={errors.role}
          hint={
            isSelf
              ? 'No podés cambiar tu propio rol. Pedile a otra persona de administración.'
              : selectedRole?.description
          }
        >
          <select
            id="team-role"
            value={values.role}
            disabled={isSelf}
            onChange={(event) => setField('role', event.target.value as StaffRole)}
            className={`${inputClass(Boolean(errors.role))} disabled:bg-slate-50 disabled:text-slate-500`}
          >
            {STAFF_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        {!isEditing && (
          <Field
            id="team-password"
            label="Contraseña inicial"
            required
            error={errors.password}
            hint={`Mínimo ${MIN_PASSWORD_LENGTH} caracteres. Se le comparte a la persona para su primer ingreso.`}
          >
            <div className="relative">
              <input
                id="team-password"
                type={isPasswordVisible ? 'text' : 'password'}
                value={values.password}
                autoComplete="new-password"
                onChange={(event) => setField('password', event.target.value)}
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
          </Field>
        )}

        {isEditing && (
          <label
            htmlFor="team-is_active"
            className={`flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 transition-colors ${
              isSelf ? 'opacity-60' : 'cursor-pointer hover:border-slate-300'
            }`}
          >
            <input
              id="team-is_active"
              type="checkbox"
              checked={values.is_active}
              disabled={isSelf}
              onChange={(event) => setField('is_active', event.target.checked)}
              className="mt-0.5 size-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm">
              <span className="font-medium text-slate-800">Acceso habilitado</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                {isSelf
                  ? 'No podés suspender tu propia cuenta.'
                  : 'Al suspenderlo no puede iniciar sesión, pero su historial de citas y cobros se conserva.'}
              </span>
            </span>
          </label>
        )}

      </form>
    </Modal>
  )
}


