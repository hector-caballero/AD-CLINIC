import { supabase } from '../../lib/supabase'
import { toAnamnesisError } from './anamnesis-errors'
import {
  MEDICAL_HISTORY_SELECT,
  type MedicalHistory,
  type MedicalHistoryInput,
} from './anamnesis-types'

/**
 * Acceso a `public.patient_medical_history`.
 *
 * Reglas del módulo:
 * - Una sola fila por paciente (clave única `patient_id`), así que guardar es
 *   siempre un `upsert`: no hay que distinguir alta de edición en la UI.
 * - `consent_signed_at` no se envía nunca: lo sella o lo limpia el trigger
 *   `handle_medical_history_consent()` según `consent_accepted`.
 * - Los detalles se mandan en `null` cuando su casilla está apagada (lo resuelve
 *   `toMedicalHistoryInput()`).
 */

/**
 * Igual que en `patients-service.ts`: el cliente de `src/lib/supabase.ts` se
 * crea sin la interfaz `Database` generada, así que PostgREST devuelve
 * `GenericStringError` cuando el `select` es un string. Esta conversión
 * documenta el contrato real de `public.patient_medical_history`.
 */
function asMedicalHistory(data: unknown): MedicalHistory {
  return data as MedicalHistory
}

/** Anamnesis del paciente o `null` si todavía no se cargó. */
export async function fetchMedicalHistory(patientId: string): Promise<MedicalHistory | null> {
  const { data, error } = await supabase
    .from('patient_medical_history')
    .select(MEDICAL_HISTORY_SELECT)
    .eq('patient_id', patientId)
    .maybeSingle()

  if (error) throw toAnamnesisError(error)

  return data ? asMedicalHistory(data) : null
}

/**
 * Guarda (crea o actualiza) la anamnesis del paciente.
 *
 * Devuelve la fila tal como quedó en la base, incluida la fecha de firma del
 * consentimiento que calculó el trigger.
 */
export async function saveMedicalHistory(
  patientId: string,
  input: MedicalHistoryInput,
): Promise<MedicalHistory> {
  const { data, error } = await supabase
    .from('patient_medical_history')
    .upsert(
      { ...input, patient_id: patientId },
      { onConflict: 'patient_id' },
    )
    .select(MEDICAL_HISTORY_SELECT)
    .single()

  if (error) throw toAnamnesisError(error)

  if (!data) {
    throw new Error('Supabase no devolvió la historia clínica guardada. Volvé a abrir la ficha.')
  }

  return asMedicalHistory(data)
}
