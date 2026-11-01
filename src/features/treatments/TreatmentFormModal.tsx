import { useState, type FormEvent, type ReactNode } from 'react'
import { Loader2, Save, WifiOff } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { formatPYG, formatPYGInput, parsePYGInput } from '../../lib/format'
import { formatDuration } from './treatment-format'
import { createTreatment, updateTreatment } from './treatments-service'
import {
  TREATMENT_CATEGORY_OPTIONS,
  normalizeTreatmentCode,
  type Treatment,
  type TreatmentFormValues,
  type TreatmentInput,
} from './treatment-types'

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,19}$/
const MIN_DURATION = 5
const MAX_DURATION = 600

const EMPTY_FORM: TreatmentFormValues = {
  code: '',
  name: '',
  category: TREATMENT_CATEGORY_OPTIONS[0].value,
  description: '',
  price: '',
  duration: '30',
  is_active: true,
}

type FormErrors = Partial<Record<keyof TreatmentFormValues, string>>

function inputClass(hasError: boolean): string {
  return [
    'w-full rounded-xl border bg-white/85 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400',
    hasError ? 'border-red-300' : 'border-slate-300 focus:border-brand-500',
  ].join(' ')
}

function toFormValues(treatment: Treatment | null): TreatmentFormValues {
  if (!treatment) return EMPTY_FORM

  return {
    code: treatment.code,
    name: treatment.name,
    category: treatment.category,
    description: treatment.description ?? '',
    price: formatPYGInput(String(treatment.default_price)),
    duration: String(treatment.default_duration_minutes),
    is_active: treatment.is_active,
  }
}

function toTreatmentInput(values: TreatmentFormValues): TreatmentInput {
  const description = values.description.trim()

  return {
    code: normalizeTreatmentCode(values.code),
    name: values.name.trim(),
    category: values.category,
    description: description ? description : null,
    default_price: parsePYGInput(values.price),
    default_duration_minutes: Number(values.duration),
    is_active: values.is_active,
  }
}

function validate(values: TreatmentFormValues): FormErrors {
  const errors: FormErrors = {}
  const code = normalizeTreatmentCode(values.code)
  const price = parsePYGInput(values.price)
  const duration = Number(values.duration)

  if (!code) {
    errors.code = 'El código es obligatorio (por ejemplo PRO-007).'
  } else if (!CODE_PATTERN.test(code)) {
    errors.code = 'Usá entre 2 y 20 caracteres: letras, números y guiones.'
  }

  if (!values.name.trim()) {
    errors.name = 'Ingresá el nombre del tratamiento.'
  } else if (values.name.trim().length < 3) {
    errors.name = 'El nombre debe tener al menos 3 caracteres.'
  }

  if (!values.category.trim()) {
    errors.category = 'Elegí una categoría.'
  }

  if (price <= 0) {
    errors.price = 'Ingresá un precio en guaraníes mayor a cero.'
  }

  if (!values.duration.trim()) {
    errors.duration = 'Ingresá la duración en minutos.'
  } else if (!Number.isInteger(duration) || duration < MIN_DURATION || duration > MAX_DURATION) {
    errors.duration = `La duración debe estar entre ${MIN_DURATION} y ${MAX_DURATION} minutos.`
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

type TreatmentFormModalProps = {
  treatment: Treatment | null
  onClose: () => void
  onSaved: (treatment: Treatment, mode: 'create' | 'edit') => void
}

/**
 * Alta y edición de tratamientos del catálogo.
 *
 * La página la monta con una `key` distinta en cada apertura, así que el estado
 * inicial siempre refleja el tratamiento seleccionado. El precio se escribe con
 * separador de miles (`150.000`) y se guarda como entero en guaraníes.
 */
export function TreatmentFormModal({ treatment, onClose, onSaved }: TreatmentFormModalProps) {
  const isOnline = useOnlineStatus()
  const [values, setValues] = useState<TreatmentFormValues>(() => toFormValues(treatment))
  const [errors, setErrors] = useState<FormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const isEditing = Boolean(treatment)

  const priceValue = parsePYGInput(values.price)
  const durationValue = Number(values.duration)
  const categoryOptions = TREATMENT_CATEGORY_OPTIONS.some(
    (option) => option.value === values.category,
  )
    ? TREATMENT_CATEGORY_OPTIONS
    : [{ value: values.category, label: values.category }, ...TREATMENT_CATEGORY_OPTIONS]

  function clearError(field: keyof TreatmentFormValues) {
    setErrors((current) => {
      if (!(field in current)) return current

      const next = { ...current }
      delete next[field]

      return next
    })
  }

  function setField<K extends keyof TreatmentFormValues>(
    field: K,
    value: TreatmentFormValues[K],
  ) {
    setValues((current) => ({ ...current, [field]: value }))
    clearError(field)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isSaving) return

    const validation = validate(values)
    setErrors(validation)
    setFormError(null)

    const firstError = Object.keys(validation)[0]

    if (firstError) {
      setFormError('Revisá los campos marcados para poder guardar.')
      document.getElementById(`treatment-${firstError}`)?.focus()
      return
    }

    if (!isOnline) {
      setFormError('Sin conexión: no se puede guardar el tratamiento. Revisá tu internet.')
      return
    }

    setIsSaving(true)

    try {
      const input = toTreatmentInput(values)
      const saved =
        isEditing && treatment
          ? await updateTreatment(treatment.id, input)
          : await createTreatment(input)

      onSaved(saved, isEditing ? 'edit' : 'create')
    } catch (cause) {
      setFormError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo guardar el tratamiento. Intentá de nuevo.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      title={isEditing ? 'Editar tratamiento' : 'Nuevo tratamiento'}
      description={
        isEditing && treatment
          ? `Actualizá el precio y la duración de ${treatment.name}.`
          : 'Definí el precio en guaraníes y la duración estándar para el cobro en recepción.'
      }
      onClose={onClose}
      isBusy={isSaving}
      size="lg"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            <span aria-hidden="true" className="text-red-500">
              *
            </span>{' '}
            Campos obligatorios
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white/85 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="treatment-form"
              disabled={isSaving || !isOnline}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              {isSaving ? 'Guardando…' : isEditing ? 'Guardar cambios' : 'Crear tratamiento'}
            </button>
          </div>
        </div>
      }
    >
      <form id="treatment-form" onSubmit={handleSubmit} noValidate className="space-y-5">
        {formError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
          >
            {!isOnline && <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
            <span>{formError}</span>
          </div>
        )}

        <fieldset className="space-y-4">
          <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Identificación
          </legend>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              id="treatment-code"
              label="Código"
              required
              error={errors.code}
              hint="Único, sin espacios"
            >
              <input
                id="treatment-code"
                type="text"
                data-autofocus
                value={values.code}
                maxLength={20}
                autoComplete="off"
                onChange={(event) => setField('code', event.target.value.toUpperCase())}
                onBlur={() => setField('code', normalizeTreatmentCode(values.code))}
                placeholder="PRO-007"
                className={`${inputClass(Boolean(errors.code))} font-mono uppercase`}
                aria-invalid={Boolean(errors.code)}
              />
            </Field>

            <Field
              id="treatment-name"
              label="Nombre"
              required
              error={errors.name}
              className="sm:col-span-2"
            >
              <input
                id="treatment-name"
                type="text"
                value={values.name}
                maxLength={120}
                autoComplete="off"
                onChange={(event) => setField('name', event.target.value)}
                placeholder="Ej.: Restauración con resina compuesta"
                className={inputClass(Boolean(errors.name))}
                aria-invalid={Boolean(errors.name)}
              />
            </Field>
          </div>

          <Field
            id="treatment-category"
            label="Categoría"
            required
            error={errors.category}
            hint="Define en qué grupo aparece dentro del catálogo."
          >
            <select
              id="treatment-category"
              value={values.category}
              onChange={(event) => setField('category', event.target.value)}
              className={inputClass(Boolean(errors.category))}
              aria-invalid={Boolean(errors.category)}
            >
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            id="treatment-description"
            label="Descripción"
            hint="Opcional · se muestra en la ficha del paciente y en el cobro."
          >
            <textarea
              id="treatment-description"
              value={values.description}
              onChange={(event) => setField('description', event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Materiales, indicaciones o alcance del procedimiento…"
              className={`${inputClass(false)} resize-y`}
            />
          </Field>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Cobro
          </legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="treatment-price"
              label="Precio"
              required
              error={errors.price}
              hint="En guaraníes, sin centavos."
            >
              <div className="relative">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-400"
                >
                  ₲
                </span>
                <input
                  id="treatment-price"
                  type="text"
                  inputMode="numeric"
                  value={values.price}
                  autoComplete="off"
                  onChange={(event) => setField('price', formatPYGInput(event.target.value))}
                  placeholder="150.000"
                  className={`${inputClass(Boolean(errors.price))} pl-8 text-right tabular-nums`}
                  aria-invalid={Boolean(errors.price)}
                />
              </div>
            </Field>

            <Field
              id="treatment-duration"
              label="Duración"
              required
              error={errors.duration}
              hint={`Minutos de sillón (${MIN_DURATION}–${MAX_DURATION}).`}
            >
              <div className="relative">
                <input
                  id="treatment-duration"
                  type="number"
                  inputMode="numeric"
                  min={MIN_DURATION}
                  max={MAX_DURATION}
                  step={5}
                  value={values.duration}
                  onChange={(event) => setField('duration', event.target.value)}
                  placeholder="30"
                  className={`${inputClass(Boolean(errors.duration))} pr-14 tabular-nums`}
                  aria-invalid={Boolean(errors.duration)}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400"
                >
                  min
                </span>
              </div>
            </Field>
          </div>

          {(priceValue > 0 || durationValue > 0) && (
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <span className="font-medium text-slate-800">Se cobrará</span>{' '}
              {formatPYG(priceValue)} · {formatDuration(durationValue)}
            </p>
          )}

          <label
            htmlFor="treatment-is_active"
            className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white/85 px-3 py-3 transition-colors hover:border-slate-300"
          >
            <input
              id="treatment-is_active"
              type="checkbox"
              checked={values.is_active}
              onChange={(event) => setField('is_active', event.target.checked)}
              className="mt-0.5 size-4 shrink-0 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm">
              <span className="font-medium text-slate-800">Disponible para cobrar</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                Si lo desactivás, deja de aparecer en el modal de cobro pero se conserva en el
                historial de los pacientes.
              </span>
            </span>
          </label>
        </fieldset>

      </form>
    </Modal>
  )
}
