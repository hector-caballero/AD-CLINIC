/**
 * Tipos de la **anamnesis digital** (hoja de historia clínica + consentimiento
 * informado).
 *
 * `public.patient_medical_history` guarda una sola fila por paciente (clave
 * única `patient_id`), así que el formulario siempre hace
 * `upsert ... on conflict (patient_id)` en lugar de crear versiones nuevas.
 *
 * Los campos "de detalle" (`treatment_details`, `disease_details`, …) solo
 * tienen sentido cuando su booleano está en `true`; `toMedicalHistoryInput()`
 * los guarda como `null` en caso contrario para que la base no acumule texto
 * huérfano.
 */

/** Fila de `public.patient_medical_history` (columnas que usa la interfaz). */
export type MedicalHistory = {
  id: string
  patient_id: string
  under_treatment: boolean
  treatment_details: string | null
  has_disease: boolean
  disease_details: string | null
  allergic_anesthetics: boolean
  allergic_penicillin: boolean
  allergic_others: boolean
  allergic_details: string | null
  has_dental_issues: boolean
  dental_issues_details: string | null
  has_pain: boolean
  pain_details: string | null
  is_pregnant: boolean
  is_breastfeeding: boolean
  /** `numeric(5,2)`: PostgREST lo entrega como número o string según el driver. */
  child_weight_kg: number | string | null
  consent_accepted: boolean
  consent_signed_at: string | null
  created_at: string
  updated_at: string
}

/**
 * Payload de guardado. `patient_id` viaja aparte (es la llave del `upsert`) y
 * `consent_signed_at` **no** se envía: lo sella el trigger
 * `handle_medical_history_consent()` en la base.
 */
export type MedicalHistoryInput = {
  under_treatment: boolean
  treatment_details: string | null
  has_disease: boolean
  disease_details: string | null
  allergic_anesthetics: boolean
  allergic_penicillin: boolean
  allergic_others: boolean
  allergic_details: string | null
  has_dental_issues: boolean
  dental_issues_details: string | null
  has_pain: boolean
  pain_details: string | null
  is_pregnant: boolean
  is_breastfeeding: boolean
  child_weight_kg: number | null
  consent_accepted: boolean
}

/** Valores del formulario: todo texto, porque los inputs no manejan `null`. */
export type AnamnesisFormValues = {
  under_treatment: boolean
  treatment_details: string
  has_disease: boolean
  disease_details: string
  allergic_anesthetics: boolean
  allergic_penicillin: boolean
  allergic_others: boolean
  allergic_details: string
  has_dental_issues: boolean
  dental_issues_details: string
  has_pain: boolean
  pain_details: string
  is_pregnant: boolean
  is_breastfeeding: boolean
  /** Peso pediátrico tal como se escribe en el input (`24,5` o `24.5`). */
  child_weight_kg: string
  consent_accepted: boolean
}

/**
 * Resultado de Gemini: los mismos campos de la tabla, ya normalizados.
 * El consentimiento queda afuera a propósito: es un acto legal que el doctor
 * marca a mano, nunca la IA.
 */
export type AnamnesisDraft = {
  under_treatment: boolean
  treatment_details: string
  has_disease: boolean
  disease_details: string
  allergic_anesthetics: boolean
  allergic_penicillin: boolean
  allergic_others: boolean
  allergic_details: string
  has_dental_issues: boolean
  dental_issues_details: string
  has_pain: boolean
  pain_details: string
  is_pregnant: boolean
  is_breastfeeding: boolean
  child_weight_kg: number | null
}

export const MEDICAL_HISTORY_SELECT = [
  'id',
  'patient_id',
  'under_treatment',
  'treatment_details',
  'has_disease',
  'disease_details',
  'allergic_anesthetics',
  'allergic_penicillin',
  'allergic_others',
  'allergic_details',
  'has_dental_issues',
  'dental_issues_details',
  'has_pain',
  'pain_details',
  'is_pregnant',
  'is_breastfeeding',
  'child_weight_kg',
  'consent_accepted',
  'consent_signed_at',
  'created_at',
  'updated_at',
].join(', ')

export const EMPTY_ANAMNESIS_FORM: AnamnesisFormValues = {
  under_treatment: false,
  treatment_details: '',
  has_disease: false,
  disease_details: '',
  allergic_anesthetics: false,
  allergic_penicillin: false,
  allergic_others: false,
  allergic_details: '',
  has_dental_issues: false,
  dental_issues_details: '',
  has_pain: false,
  pain_details: '',
  is_pregnant: false,
  is_breastfeeding: false,
  child_weight_kg: '',
  consent_accepted: false,
}

/** `numeric(5,2)` → texto del input (`24.50` → `24,5`). */
function weightToInput(value: number | string | null): string {
  if (value === null || value === '') return ''

  const parsed = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(parsed) || parsed <= 0) return ''

  // Sin decimales cuando es un entero (12 → "12", no "12,00").
  return Number.isInteger(parsed) ? String(parsed) : String(parsed).replace('.', ',')
}

/** Fila de la base → valores del formulario. */
export function toAnamnesisForm(record: MedicalHistory | null): AnamnesisFormValues {
  if (!record) return EMPTY_ANAMNESIS_FORM

  return {
    under_treatment: record.under_treatment,
    treatment_details: record.treatment_details ?? '',
    has_disease: record.has_disease,
    disease_details: record.disease_details ?? '',
    allergic_anesthetics: record.allergic_anesthetics,
    allergic_penicillin: record.allergic_penicillin,
    allergic_others: record.allergic_others,
    allergic_details: record.allergic_details ?? '',
    has_dental_issues: record.has_dental_issues,
    dental_issues_details: record.dental_issues_details ?? '',
    has_pain: record.has_pain,
    pain_details: record.pain_details ?? '',
    is_pregnant: record.is_pregnant,
    is_breastfeeding: record.is_breastfeeding,
    child_weight_kg: weightToInput(record.child_weight_kg),
    consent_accepted: record.consent_accepted,
  }
}

/**
 * Peso escrito a mano → `numeric(5,2)`.
 *
 * Acepta coma o punto decimal (`24,5` / `24.5`) y devuelve `null` para vacío o
 * fuera del rango que valida la base (`> 0` y `<= 250`), así el error se ve en
 * el formulario y no como `23514` al guardar.
 */
export function parseWeightKg(value: string): number | null {
  const normalized = value.trim().replace(',', '.')

  if (!normalized) return null

  const parsed = Number(normalized)

  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 250) return null

  return Math.round(parsed * 100) / 100
}

/** El detalle solo se guarda cuando su casilla está marcada. */
function detailOrNull(flag: boolean, value: string): string | null {
  if (!flag) return null

  const trimmed = value.trim()

  return trimmed ? trimmed : null
}

/** Valores del formulario → payload del `upsert`. */
export function toMedicalHistoryInput(values: AnamnesisFormValues): MedicalHistoryInput {
  const hasAllergy =
    values.allergic_anesthetics || values.allergic_penicillin || values.allergic_others

  return {
    under_treatment: values.under_treatment,
    treatment_details: detailOrNull(values.under_treatment, values.treatment_details),
    has_disease: values.has_disease,
    disease_details: detailOrNull(values.has_disease, values.disease_details),
    allergic_anesthetics: values.allergic_anesthetics,
    allergic_penicillin: values.allergic_penicillin,
    allergic_others: values.allergic_others,
    allergic_details: detailOrNull(hasAllergy, values.allergic_details),
    has_dental_issues: values.has_dental_issues,
    dental_issues_details: detailOrNull(values.has_dental_issues, values.dental_issues_details),
    has_pain: values.has_pain,
    pain_details: detailOrNull(values.has_pain, values.pain_details),
    is_pregnant: values.is_pregnant,
    is_breastfeeding: values.is_breastfeeding,
    child_weight_kg: parseWeightKg(values.child_weight_kg),
    consent_accepted: values.consent_accepted,
  }
}

/** Texto que propuso la IA; si no dictó nada, se conserva lo que ya había. */
function mergeDetail(draftValue: string, currentValue: string): string {
  const trimmed = draftValue.trim()

  return trimmed ? trimmed : currentValue
}

/**
 * Aplica el dictado de Gemini sobre el formulario.
 *
 * Las casillas Sí/No las define la IA; los detalles solo se reemplazan cuando
 * dictó un texto (si dijo «toma medicación» sin especificar, no se borra lo que
 * el doctor ya había escrito). El consentimiento nunca se toca.
 */
export function mergeAnamnesisDraft(
  values: AnamnesisFormValues,
  draft: AnamnesisDraft,
): AnamnesisFormValues {
  const hasAllergy =
    draft.allergic_anesthetics || draft.allergic_penicillin || draft.allergic_others

  return {
    ...values,
    under_treatment: draft.under_treatment,
    treatment_details: mergeDetail(draft.treatment_details, values.treatment_details),
    has_disease: draft.has_disease,
    disease_details: mergeDetail(draft.disease_details, values.disease_details),
    allergic_anesthetics: draft.allergic_anesthetics,
    allergic_penicillin: draft.allergic_penicillin,
    allergic_others: draft.allergic_others,
    allergic_details: hasAllergy
      ? mergeDetail(draft.allergic_details, values.allergic_details)
      : values.allergic_details,
    has_dental_issues: draft.has_dental_issues,
    dental_issues_details: mergeDetail(draft.dental_issues_details, values.dental_issues_details),
    has_pain: draft.has_pain,
    pain_details: mergeDetail(draft.pain_details, values.pain_details),
    is_pregnant: draft.is_pregnant,
    is_breastfeeding: draft.is_breastfeeding,
    child_weight_kg:
      draft.child_weight_kg === null ? values.child_weight_kg : weightToInput(draft.child_weight_kg),
    consent_accepted: values.consent_accepted,
  }
}
