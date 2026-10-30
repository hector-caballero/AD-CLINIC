import { formatPatientDocument, formatPhonePY } from '../../lib/format'
import type { Patient } from './patient-types'

/** Columnas del paciente que necesita un selector (citas, caja, tratamientos). */
export type PatientOption = Pick<
  Patient,
  | 'id'
  | 'first_name'
  | 'last_name'
  | 'document_type'
  | 'document_number'
  | 'phone'
  | 'phone_alt'
> & {
  /** La agenda embebe pacientes sin `status`; el selector lo muestra si existe. */
  status?: Patient['status']
}

/** Documento y teléfono del paciente en una línea (`C.I. 1.234.567 · 0981 123 456`). */
export function patientContactLabel(patient: PatientOption | null): string {
  if (!patient) return ''

  return [
    formatPatientDocument(patient.document_type, patient.document_number),
    patient.phone ? formatPhonePY(patient.phone) : '',
  ]
    .filter((value) => value && value !== '—')
    .join(' · ')
}
