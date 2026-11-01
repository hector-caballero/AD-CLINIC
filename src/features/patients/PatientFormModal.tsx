import { useState, type FormEvent, type ReactNode } from 'react'
import { Loader2, Save, WifiOff } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { TagInput } from '../../components/ui/TagInput'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import {
  formatDocumentNumber,
  formatPhonePY,
  isValidDocumentNumber,
  normalizeDocumentNumber,
  normalizePhone,
  resolveDocumentType,
  type ParaguayDocumentType,
} from '../../lib/format'
import { createPatient, updatePatient } from './patients-service'
import {
  DOCUMENT_TYPE_OPTIONS,
  getPatientFullName,
  type Patient,
  type PatientFormValues,
  type PatientInput,
} from './patient-types'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const EMPTY_FORM: PatientFormValues = {
  first_name: '',
  last_name: '',
  document_type: 'CI',
  document_number: '',
  birth_date: '',
  phone: '',
  phone_alt: '',
  email: '',
  address: '',
  allergies: [],
  medical_conditions: [],
  current_medications: [],
  medical_notes: '',
  notes: '',
  status: 'active',
}

const ALLERGY_SUGGESTIONS = [
  'Penicilina',
  'Látex',
  'Anestésicos',
  'Ibuprofeno',
  'Metales',
] as const

const CONDITION_SUGGESTIONS = [
  'Diabetes',
  'Hipertensión',
  'Cardiopatía',
  'Coagulopatía',
  'Embarazo',
] as const

const MEDICATION_SUGGESTIONS = [
  'Anticoagulantes',
  'Antibióticos',
  'Antihipertensivos',
  'Corticoides',
] as const

function inputClass(hasError: boolean): string {
  return [
    'w-full rounded-xl border bg-white/85 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400',
    hasError ? 'border-red-300' : 'border-slate-300 focus:border-brand-500',
  ].join(' ')
}

function toFormValues(patient: Patient | null): PatientFormValues {
  if (!patient) return EMPTY_FORM

  const documentType = resolveDocumentType(patient.document_type)

  return {
    first_name: patient.first_name,
    last_name: patient.last_name,
    document_type: documentType,
    document_number: formatDocumentNumber(patient.document_number ?? '', documentType),
    birth_date: patient.birth_date?.slice(0, 10) ?? '',
    phone: formatPhonePY(patient.phone),
    phone_alt: patient.phone_alt ? formatPhonePY(patient.phone_alt) : '',
    email: patient.email ?? '',
    address: patient.address ?? '',
    allergies: patient.allergies ?? [],
    medical_conditions: patient.medical_conditions ?? [],
    current_medications: patient.current_medications ?? [],
    medical_notes: patient.medical_notes ?? '',
    notes: patient.notes ?? '',
    status: patient.status,
  }
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()

  return trimmed ? trimmed : null
}

function toPatientInput(values: PatientFormValues): PatientInput {
  return {
    first_name: values.first_name.trim(),
    last_name: values.last_name.trim(),
    document_type: values.document_type,
    document_number: values.document_number
      ? normalizeDocumentNumber(values.document_number, values.document_type)
      : null,
    birth_date: values.birth_date || null,
    phone: normalizePhone(values.phone),
    phone_alt: values.phone_alt ? normalizePhone(values.phone_alt) : null,
    email: values.email.trim() ? values.email.trim().toLowerCase() : null,
    address: emptyToNull(values.address),
    allergies: values.allergies,
    medical_conditions: values.medical_conditions,
    current_medications: values.current_medications,
    medical_notes: emptyToNull(values.medical_notes),
    notes: emptyToNull(values.notes),
    status: values.status,
  }
}

type FormErrors = Partial<Record<keyof PatientFormValues, string>>

function validate(values: PatientFormValues, today: string): FormErrors {
  const errors: FormErrors = {}
  const phoneDigits = normalizePhone(values.phone)
  const altPhoneDigits = normalizePhone(values.phone_alt)

  if (!values.first_name.trim()) errors.first_name = 'Ingresá al menos un nombre.'
  if (!values.last_name.trim()) errors.last_name = 'Ingresá al menos un apellido.'

  if (!phoneDigits) {
    errors.phone = 'El teléfono es obligatorio.'
  } else if (phoneDigits.length < 6) {
    errors.phone = 'Ingresá un teléfono válido (mínimo 6 dígitos).'
  } else if (phoneDigits.length > 15) {
    errors.phone = 'El teléfono no puede superar los 15 dígitos.'
  }

  if (altPhoneDigits && altPhoneDigits.length < 6) {
    errors.phone_alt = 'Revisá el teléfono alternativo.'
  }

  if (
    values.document_number.trim() &&
    !isValidDocumentNumber(values.document_number, values.document_type)
  ) {
    errors.document_number =
      values.document_type === 'CI'
        ? 'La C.I. debe tener entre 5 y 8 dígitos.'
        : values.document_type === 'RUC'
          ? 'El RUC debe tener 7, 8 o 9 dígitos (base + verificador).'
          : 'El pasaporte debe tener entre 6 y 12 letras o números.'
  }

  if (values.email.trim() && !EMAIL_PATTERN.test(values.email.trim())) {
    errors.email = 'Ingresá un correo válido (nombre@dominio.com).'
  }

  if (values.birth_date) {
    if (values.birth_date <= '1900-01-01') {
      errors.birth_date = 'La fecha debe ser posterior al 01/01/1900.'
    } else if (values.birth_date > today) {
      errors.birth_date = 'La fecha de nacimiento no puede ser futura.'
    }
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

type PatientFormModalProps = {
  patient: Patient | null
  onClose: () => void
  onSaved: (patient: Patient, mode: 'create' | 'edit') => void
}

/**
 * Alta y edición de pacientes.
 *
 * La página lo monta con una `key` distinta en cada apertura, así que el estado
 * inicial siempre refleja la ficha seleccionada.
 */
export function PatientFormModal({ patient, onClose, onSaved }: PatientFormModalProps) {
  const isOnline = useOnlineStatus()
  const [values, setValues] = useState<PatientFormValues>(() => toFormValues(patient))
  const [errors, setErrors] = useState<FormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [today] = useState(() => new Date().toISOString().slice(0, 10))
  const isEditing = Boolean(patient)
  const activeDocumentOption =
    DOCUMENT_TYPE_OPTIONS.find((option) => option.value === values.document_type) ??
    DOCUMENT_TYPE_OPTIONS[0]

  function clearError(field: keyof PatientFormValues) {
    setErrors((current) => {
      if (!(field in current)) return current

      const next = { ...current }
      delete next[field]

      return next
    })
  }

  function setField<K extends keyof PatientFormValues>(field: K, value: PatientFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }))
    clearError(field)
  }

  function handleDocumentTypeChange(type: ParaguayDocumentType) {
    setValues((current) => ({
      ...current,
      document_type: type,
      document_number: formatDocumentNumber(current.document_number, type),
    }))
    clearError('document_number')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isSaving) return

    const validation = validate(values, today)
    setErrors(validation)
    setFormError(null)

    const firstError = Object.keys(validation)[0]

    if (firstError) {
      setFormError('Revisá los campos marcados para poder guardar.')
      document.getElementById(`patient-${firstError}`)?.focus()
      return
    }

    if (!isOnline) {
      setFormError('Sin conexión: no se puede guardar la ficha. Revisá tu internet.')
      return
    }

    setIsSaving(true)

    try {
      const input = toPatientInput(values)
      const saved =
        isEditing && patient
          ? await updatePatient(patient.id, input)
          : await createPatient(input)

      onSaved(saved, isEditing ? 'edit' : 'create')
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : 'No se pudo guardar la ficha. Intentá de nuevo.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      title={isEditing ? 'Editar paciente' : 'Nuevo paciente'}
      description={
        isEditing && patient
          ? `Actualizá los datos de ${getPatientFullName(patient)}.`
          : 'Completá la ficha. Solo los nombres, los apellidos y el teléfono son obligatorios.'
      }
      onClose={onClose}
      isBusy={isSaving}
      size="xl"
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
              form="patient-form"
              disabled={isSaving || !isOnline}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              {isSaving ? 'Guardando…' : isEditing ? 'Guardar cambios' : 'Registrar paciente'}
            </button>
          </div>
        </div>
      }
    >
      <form id="patient-form" onSubmit={handleSubmit} noValidate className="space-y-7">
        {!isOnline && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800 ring-1 ring-amber-200">
            <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Sin conexión: podés completar la ficha, pero para guardarla necesitás internet.
          </p>
        )}

        {formError && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700 ring-1 ring-red-200"
          >
            {formError}
          </p>
        )}

        <fieldset className="space-y-4">
          <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Identificación
          </legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="patient-document_type" label="Tipo de documento" required>
              <select
                id="patient-document_type"
                value={values.document_type}
                onChange={(event) =>
                  handleDocumentTypeChange(event.target.value as ParaguayDocumentType)
                }
                className={inputClass(false)}
              >
                {DOCUMENT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              id="patient-document_number"
              label="Número de documento"
              error={errors.document_number}
              hint={`Formato: ${activeDocumentOption.hint}`}
            >
              <input
                id="patient-document_number"
                type="text"
                value={values.document_number}
                onChange={(event) =>
                  setField(
                    'document_number',
                    formatDocumentNumber(event.target.value, values.document_type),
                  )
                }
                inputMode={values.document_type === 'Pasaporte' ? 'text' : 'numeric'}
                autoComplete="off"
                placeholder={activeDocumentOption.hint}
                maxLength={15}
                aria-invalid={Boolean(errors.document_number)}
                aria-describedby={
                  errors.document_number
                    ? 'patient-document_number-error'
                    : 'patient-document_number-hint'
                }
                className={inputClass(Boolean(errors.document_number))}
              />
            </Field>

            <Field id="patient-first_name" label="Nombres" required error={errors.first_name}>
              <input
                id="patient-first_name"
                type="text"
                value={values.first_name}
                onChange={(event) => setField('first_name', event.target.value)}
                autoComplete="given-name"
                maxLength={80}
                placeholder="Ana María"
                aria-invalid={Boolean(errors.first_name)}
                aria-describedby={errors.first_name ? 'patient-first_name-error' : undefined}
                className={inputClass(Boolean(errors.first_name))}
              />
            </Field>

            <Field id="patient-last_name" label="Apellidos" required error={errors.last_name}>
              <input
                id="patient-last_name"
                type="text"
                value={values.last_name}
                onChange={(event) => setField('last_name', event.target.value)}
                autoComplete="family-name"
                maxLength={80}
                placeholder="López Giménez"
                aria-invalid={Boolean(errors.last_name)}
                aria-describedby={errors.last_name ? 'patient-last_name-error' : undefined}
                className={inputClass(Boolean(errors.last_name))}
              />
            </Field>

            <Field id="patient-birth_date" label="Fecha de nacimiento" error={errors.birth_date}>
              <input
                id="patient-birth_date"
                type="date"
                value={values.birth_date}
                onChange={(event) => setField('birth_date', event.target.value)}
                min="1900-01-02"
                max={today}
                autoComplete="bday"
                aria-invalid={Boolean(errors.birth_date)}
                aria-describedby={errors.birth_date ? 'patient-birth_date-error' : undefined}
                className={inputClass(Boolean(errors.birth_date))}
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Contacto
          </legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="patient-phone"
              label="Teléfono"
              required
              error={errors.phone}
              hint="Móvil 0981 123 456 · fijo 021 123 456"
            >
              <input
                id="patient-phone"
                type="tel"
                value={values.phone}
                onChange={(event) => setField('phone', formatPhonePY(event.target.value))}
                autoComplete="tel"
                inputMode="tel"
                placeholder="0981 123 456"
                maxLength={18}
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={errors.phone ? 'patient-phone-error' : 'patient-phone-hint'}
                className={inputClass(Boolean(errors.phone))}
              />
            </Field>

            <Field
              id="patient-phone_alt"
              label="Teléfono alternativo"
              error={errors.phone_alt}
              hint="Opcional"
            >
              <input
                id="patient-phone_alt"
                type="tel"
                value={values.phone_alt}
                onChange={(event) => setField('phone_alt', formatPhonePY(event.target.value))}
                autoComplete="tel"
                inputMode="tel"
                placeholder="0972 000 000"
                maxLength={18}
                aria-invalid={Boolean(errors.phone_alt)}
                aria-describedby={errors.phone_alt ? 'patient-phone_alt-error' : undefined}
                className={inputClass(Boolean(errors.phone_alt))}
              />
            </Field>

            <Field id="patient-email" label="Email" error={errors.email} hint="Opcional">
              <input
                id="patient-email"
                type="email"
                value={values.email}
                onChange={(event) => setField('email', event.target.value)}
                autoComplete="email"
                placeholder="paciente@correo.com"
                maxLength={160}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'patient-email-error' : undefined}
                className={inputClass(Boolean(errors.email))}
              />
            </Field>

            <Field id="patient-address" label="Dirección" hint="Opcional">
              <input
                id="patient-address"
                type="text"
                value={values.address}
                onChange={(event) => setField('address', event.target.value)}
                autoComplete="street-address"
                placeholder="Av. Mcal. López 1234, Asunción"
                maxLength={200}
                className={inputClass(false)}
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Antecedentes clínicos
          </legend>

          <div className="grid gap-5 sm:grid-cols-2">
            <TagInput
              id="patient-allergies"
              label="Alergias"
              value={values.allergies}
              onChange={(next) => setField('allergies', next)}
              placeholder="Ej.: penicilina, látex…"
              hint="Enter o coma para agregar cada alergia."
              suggestions={ALLERGY_SUGGESTIONS}
              tone="rose"
            />

            <TagInput
              id="patient-medical_conditions"
              label="Condiciones médicas"
              value={values.medical_conditions}
              onChange={(next) => setField('medical_conditions', next)}
              placeholder="Ej.: diabetes, hipertensión…"
              hint="Antecedentes relevantes para el tratamiento."
              suggestions={CONDITION_SUGGESTIONS}
              tone="amber"
            />

            <TagInput
              id="patient-current_medications"
              label="Medicación actual"
              value={values.current_medications}
              onChange={(next) => setField('current_medications', next)}
              placeholder="Ej.: anticoagulantes…"
              hint="Medicamentos que toma el paciente."
              suggestions={MEDICATION_SUGGESTIONS}
              tone="brand"
            />

            <Field
              id="patient-medical_notes"
              label="Observaciones clínicas"
              hint="Opcional"
              className="sm:col-span-2"
            >
              <textarea
                id="patient-medical_notes"
                value={values.medical_notes}
                onChange={(event) => setField('medical_notes', event.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Antecedentes quirúrgicos, embarazo, contraindicaciones…"
                className={`${inputClass(false)} resize-y`}
              />
            </Field>
          </div>
        </fieldset>

        <fieldset className="space-y-4">
          <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Notas y estado
          </legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="patient-notes"
              label="Notas adicionales"
              hint="Opcional · visibles en la ficha"
              className="sm:col-span-2"
            >
              <textarea
                id="patient-notes"
                value={values.notes}
                onChange={(event) => setField('notes', event.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Preferencias de atención, datos de facturación, observaciones administrativas…"
                className={`${inputClass(false)} resize-y`}
              />
            </Field>

            <Field
              id="patient-status"
              label="Estado"
              hint="Los pacientes inactivos no se agendan."
            >
              <select
                id="patient-status"
                value={values.status}
                onChange={(event) =>
                  setField('status', event.target.value as PatientFormValues['status'])
                }
                className={inputClass(false)}
              >
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
                <option value="archived">Archivado</option>
              </select>
            </Field>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
