import type { Patient, PatientStatusFilter } from './patient-types'

export type PatientSearchFilters = {
  query: string
  status: PatientStatusFilter
}

/** Minúsculas y sin acentos, para que `Lopez` encuentre a `López`. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function matchesStatus(patient: Patient, status: PatientStatusFilter): boolean {
  if (status === 'all') return true
  if (status === 'active') return patient.status === 'active'

  return patient.status !== 'active'
}

function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D+/g, '')
}

/**
 * Búsqueda en memoria sobre los pacientes ya cargados: responde en cada tecla.
 *
 * Acepta nombre/apellido (sin importar acentos), email, documento con o sin
 * puntos (`1.234.567`) y teléfonos con o sin espacios (`0981 123 456`).
 */
export function filterPatients(patients: Patient[], filters: PatientSearchFilters): Patient[] {
  const query = normalizeSearchText(filters.query)
  const digits = filters.query.replace(/\D+/g, '')

  return patients.filter((patient) => {
    if (!matchesStatus(patient, filters.status)) return false
    if (!query) return true

    const fullName = normalizeSearchText(`${patient.first_name} ${patient.last_name}`)

    if (fullName.includes(query)) return true
    if (normalizeSearchText(patient.email ?? '').includes(query)) return true
    if (normalizeSearchText(patient.document_number ?? '').includes(query)) return true

    if (digits) {
      if (digitsOnly(patient.document_number).includes(digits)) return true
      if (digitsOnly(patient.phone).includes(digits)) return true
      if (digitsOnly(patient.phone_alt).includes(digits)) return true
    }

    return false
  })
}
