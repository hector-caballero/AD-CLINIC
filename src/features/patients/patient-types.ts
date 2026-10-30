import type { ParaguayDocumentType } from '../../lib/format'

/**
 * Tipos del módulo de pacientes.
 *
 * La base de datos guarda los documentos sin puntos ni guiones
 * (`1234567`, `800123456`) y el tipo con los valores `CI`, `RUC` o
 * `Pasaporte`. El formato visual se aplica solo en la interfaz.
 */

export const DOCUMENT_TYPE_OPTIONS: {
  value: ParaguayDocumentType
  label: string
  hint: string
}[] = [
  { value: 'CI', label: 'Cédula de Identidad', hint: '1.234.567' },
  { value: 'RUC', label: 'RUC', hint: '80012345-6' },
  { value: 'Pasaporte', label: 'Pasaporte', hint: 'AB123456' },
]

export type PatientStatus = 'active' | 'inactive' | 'archived'

export type PatientStatusFilter = 'all' | 'active' | 'inactive'

/** Fila de `public.patients` (solo las columnas que usa la interfaz). */
export type Patient = {
  id: string
  first_name: string
  last_name: string
  document_type: ParaguayDocumentType | string
  document_number: string | null
  birth_date: string | null
  phone: string
  phone_alt: string | null
  email: string | null
  address: string | null
  city: string | null
  allergies: string[]
  medical_conditions: string[]
  current_medications: string[]
  medical_notes: string | null
  notes: string | null
  status: PatientStatus
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** Payload de alta/edición (lo que viaja a Supabase). */
export type PatientInput = {
  first_name: string
  last_name: string
  document_type: ParaguayDocumentType
  document_number: string | null
  birth_date: string | null
  phone: string
  phone_alt: string | null
  email: string | null
  address: string | null
  allergies: string[]
  medical_conditions: string[]
  current_medications: string[]
  medical_notes: string | null
  notes: string | null
  status: PatientStatus
}

/** Valores del formulario: todo texto, porque los inputs no manejan `null`. */
export type PatientFormValues = {
  first_name: string
  last_name: string
  document_type: ParaguayDocumentType
  document_number: string
  birth_date: string
  phone: string
  phone_alt: string
  email: string
  address: string
  allergies: string[]
  medical_conditions: string[]
  current_medications: string[]
  medical_notes: string
  notes: string
  status: PatientStatus
}

export const PATIENT_SELECT = [
  'id',
  'first_name',
  'last_name',
  'document_type',
  'document_number',
  'birth_date',
  'phone',
  'phone_alt',
  'email',
  'address',
  'city',
  'allergies',
  'medical_conditions',
  'current_medications',
  'medical_notes',
  'notes',
  'status',
  'created_at',
  'updated_at',
  'deleted_at',
].join(', ')

export function getPatientFullName(
  patient: Pick<Patient, 'first_name' | 'last_name'>,
): string {
  return `${patient.first_name} ${patient.last_name}`.replace(/\s+/g, ' ').trim()
}

/** Orden alfabético usado en el listado y al insertar un paciente nuevo. */
export function comparePatients(a: Patient, b: Patient): number {
  const byLastName = a.last_name.localeCompare(b.last_name, 'es', { sensitivity: 'base' })

  if (byLastName !== 0) return byLastName

  const byFirstName = a.first_name.localeCompare(b.first_name, 'es', { sensitivity: 'base' })

  return byFirstName !== 0 ? byFirstName : a.id.localeCompare(b.id)
}
