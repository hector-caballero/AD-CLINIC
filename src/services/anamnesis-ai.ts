import type { AnamnesisDraft } from '../features/patients/anamnesis-types'
import {
  GEMINI_MISSING_KEY_MESSAGE,
  GeminiError,
  isGeminiConfigured,
  requestGeminiJson,
} from './gemini-flash'
import {
  UNSUPPORTED_BROWSER_MESSAGE as UNSUPPORTED_SPEECH_MESSAGE,
  createSpeechDictation,
  isSpeechDictationSupported,
} from './speech-dictation'

/**
 * Dictado por voz y estructuración con IA para la **anamnesis**.
 *
 * Dos piezas independientes:
 *
 * 1. **Transcripción** — Web Speech API nativa del navegador
 *    (`SpeechRecognition` / `webkitSpeechRecognition`), implementada en
 *    `speech-dictation.ts` y compartida con el dictado del odontograma. Es
 *    gratuita y no sube audio a ningún servidor propio: el navegador transcribe
 *    en streaming, así que el doctor ve el texto mientras habla.
 * 2. **Estructuración** — Gemini Flash con *JSON Mode*: recibe el texto y
 *    devuelve las casillas Sí/No y los detalles de la hoja de anamnesis. La
 *    respuesta se normaliza en `normalizeDraft()` antes de tocar el
 *    formulario, porque el modelo puede devolver tipos inesperados.
 *
 * Aviso de seguridad: `VITE_GEMINI_API_KEY` viaja en el bundle (Vite solo
 * inyecta las variables `VITE_*` en el navegador). Es una clave de **uso
 * interno de la clínica**, no un secreto de servidor: conviene una clave
 * exclusiva, con cuota limitada, y rotarla si se filtra. La transcripción de
 * un paciente es un dato sensible: no se guarda y solo se envía a Gemini.
 */

// -----------------------------------------------------------------------------
// 1. Web Speech API
//    La transcripción vive en `speech-dictation.ts` (la comparte el dictado del
//    odontograma); acá se reexporta el soporte del navegador.
// -----------------------------------------------------------------------------

export { isSpeechDictationSupported as isDictationSupported } from './speech-dictation'

/**
 * Copy propio de la ficha: los mensajes base viven en `gemini-flash.ts` y
 * `speech-dictation.ts` (los comparte el dictado del odontograma).
 */
const MISSING_KEY_MESSAGE = `${GEMINI_MISSING_KEY_MESSAGE} Podés completar la ficha a mano mientras tanto.`

const UNSUPPORTED_BROWSER_MESSAGE = `${UNSUPPORTED_SPEECH_MESSAGE} La ficha se puede completar a mano.`

/** Estado del dictado asistido, tal como lo muestra el formulario. */
export type AnamnesisAiStatus = {
  /** `true` solo si hay clave de Gemini y el navegador soporta dictado. */
  ready: boolean
  /** Aviso para mostrar en el formulario (`null` si todo está en orden). */
  warning: string | null
}

/**
 * Resume por qué el dictado puede estar deshabilitado: sin clave de Gemini la
 * transcripción funcionaría pero no habría estructuración, así que se avisa
 * antes de que el doctor pierda tiempo dictando.
 */
export function getAnamnesisAiStatus(): AnamnesisAiStatus {
  if (!isGeminiConfigured()) {
    return { ready: false, warning: MISSING_KEY_MESSAGE }
  }

  if (!isSpeechDictationSupported()) {
    return { ready: false, warning: UNSUPPORTED_BROWSER_MESSAGE }
  }

  return { ready: true, warning: null }
}

/**
 * Error del dictado o de Gemini, con mensaje listo para mostrar.
 *
 * Es el mismo tipo que usa el resto de la app (`GeminiError`): `status` trae el
 * HTTP status cuando el error vino del servicio (`null` para el micrófono).
 */
export { GeminiError as AnamnesisAiError }

// -----------------------------------------------------------------------------
// 2. Dictado continuo
// -----------------------------------------------------------------------------

export type AnamnesisDictationHandlers = {
  /** Texto acumulado (final) y el fragmento provisorio que todavía se escucha. */
  onTranscript: (finalText: string, interimText: string) => void
  onError: (message: string) => void
  onStateChange?: (state: 'listening' | 'idle') => void
}

export type AnamnesisDictation = {
  start: () => void
  stop: () => void
  /** Corta el micrófono y descarta los callbacks (al cerrar el modal). */
  dispose: () => void
}

/**
 * Crea un dictado continuo en español para la hoja de anamnesis.
 *
 * Envuelve `createSpeechDictation` (la misma implementación que usa el dictado
 * del odontograma) y traduce el navegador sin soporte al tipo de la ficha.
 */
export function createAnamnesisDictation(
  handlers: AnamnesisDictationHandlers,
): AnamnesisDictation {
  try {
    return createSpeechDictation(handlers)
  } catch (cause) {
    throw new GeminiError(
      cause instanceof Error ? cause.message : UNSUPPORTED_BROWSER_MESSAGE,
    )
  }
}

// -----------------------------------------------------------------------------
// 3. Gemini Flash (JSON Mode)
// -----------------------------------------------------------------------------

/**
 * Tope de texto que se envía a Gemini (un dictado real ronda los 600–1200).
 */
const MAX_TRANSCRIPT_CHARS = 4000

const SYSTEM_INSTRUCTION = [
  'Eres un asistente odontológico de AD Clinic (Asunción, Paraguay).',
  'Recibes el dictado en español de un odontólogo sobre un paciente y lo convertís en la ficha de anamnesis.',
  '',
  'Reglas:',
  '1. Devolvés únicamente el JSON del esquema. Sin explicaciones, sin markdown y sin texto fuera del JSON.',
  '2. Marcá una casilla en true solo si el dictado lo afirma de forma explícita. Ante la duda, false.',
  '3. Cada campo *_details lleva la frase corta y textual del dictado (medicamentos, enfermedades, tipo de alergia, etc.).',
  '4. Si un dato no se menciona, dejá los booleanos en false, los textos en "" y child_weight_kg en 0.',
  '5. child_weight_kg solo aplica a pacientes pediátricos: pasá el peso en kilos como número (12.5).',
  '6. allergic_anesthetics es alergia a anestésicos; allergic_penicillin, a penicilina; allergic_others, a cualquier otra cosa (látex, ibuprofeno, metales…).',
  '7. has_dental_issues cubre antecedentes odontológicos: hemorragias, reacciones a anestesias previas, tratamientos complicados.',
  '8. is_pregnant e is_breastfeeding solo se marcan si el dictado los menciona.',
  '9. No inventes datos clínicos ni completes con suposiciones.',
].join('\n')

/**
 * Esquema de salida (subconjunto OpenAPI de Gemini).
 * Los tipos van en MAYÚSCULAS porque viajan al endpoint REST `v1beta`.
 */
const ANAMNESIS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    under_treatment: {
      type: 'BOOLEAN',
      description: '¿El paciente está bajo tratamiento o toma medicación?',
    },
    treatment_details: {
      type: 'STRING',
      description: 'Medicación o tratamiento que menciona el dictado. Vacío si no se menciona.',
    },
    has_disease: { type: 'BOOLEAN', description: '¿El paciente presenta alguna enfermedad?' },
    disease_details: {
      type: 'STRING',
      description: 'Enfermedades mencionadas (diabetes, hipertensión, etc.). Vacío si no se menciona.',
    },
    allergic_anesthetics: { type: 'BOOLEAN', description: 'Alergia a anestésicos.' },
    allergic_penicillin: { type: 'BOOLEAN', description: 'Alergia a la penicilina.' },
    allergic_others: { type: 'BOOLEAN', description: 'Alergia a otras sustancias distintas de anestésicos y penicilina.' },
    allergic_details: {
      type: 'STRING',
      description: 'Detalle de las alergias mencionadas. Vacío si no se menciona.',
    },
    has_dental_issues: {
      type: 'BOOLEAN',
      description: 'Antecedentes odontológicos: hemorragias, reacciones a anestesias previas.',
    },
    dental_issues_details: {
      type: 'STRING',
      description: 'Detalle de esos antecedentes. Vacío si no se menciona.',
    },
    has_pain: { type: 'BOOLEAN', description: '¿Tiene dolor o molestias actuales?' },
    pain_details: {
      type: 'STRING',
      description: 'Zona y tipo de dolor o molestia. Vacío si no se menciona.',
    },
    is_pregnant: { type: 'BOOLEAN', description: 'Paciente embarazada.' },
    is_breastfeeding: { type: 'BOOLEAN', description: 'Paciente en período de lactancia.' },
    child_weight_kg: {
      type: 'NUMBER',
      description: 'Peso del paciente pediátrico en kilos. 0 si no se menciona o es adulto.',
    },
  },
  required: [
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
  ],
}

const EMPTY_DICTATION_MESSAGE =
  'El dictado está vacío: hablá al menos una frase y volvé a intentar.'

// --- Normalización del JSON ---------------------------------------------------
// El modelo puede devolver `true` como string, textos con espacios o el peso
// como "0": todo se sanea acá, así el formulario recibe siempre lo que espera.

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return /^(true|s[ií]|1)$/i.test(value.trim())

  return false
}

function asText(value: unknown): string {
  if (typeof value !== 'string') return ''

  return value.trim().slice(0, 500)
}

function asWeight(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)

  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 250) return null

  return Math.round(parsed * 100) / 100
}

/** JSON de Gemini → `AnamnesisDraft` con tipos garantizados. */
function normalizeDraft(value: unknown): AnamnesisDraft {
  const candidate = (value ?? {}) as Record<string, unknown>

  return {
    under_treatment: asBoolean(candidate.under_treatment),
    treatment_details: asText(candidate.treatment_details),
    has_disease: asBoolean(candidate.has_disease),
    disease_details: asText(candidate.disease_details),
    allergic_anesthetics: asBoolean(candidate.allergic_anesthetics),
    allergic_penicillin: asBoolean(candidate.allergic_penicillin),
    allergic_others: asBoolean(candidate.allergic_others),
    allergic_details: asText(candidate.allergic_details),
    has_dental_issues: asBoolean(candidate.has_dental_issues),
    dental_issues_details: asText(candidate.dental_issues_details),
    has_pain: asBoolean(candidate.has_pain),
    pain_details: asText(candidate.pain_details),
    is_pregnant: asBoolean(candidate.is_pregnant),
    is_breastfeeding: asBoolean(candidate.is_breastfeeding),
    child_weight_kg: asWeight(candidate.child_weight_kg),
  }
}

/**
 * Convierte el dictado en la estructura de la hoja de anamnesis.
 *
 * Lanza `GeminiError` (alias `AnamnesisAiError`) con un mensaje listo para
 * mostrar si falta la API key, no hay red, la clave no sirve, se agotó la cuota
 * o el modelo dejó de existir. La petición, el timeout y la cadena de modelos
 * viven en `gemini-flash.ts` (los comparte el dictado del odontograma).
 */
export async function parseAnamnesisWithGemini(
  transcriptionText: string,
): Promise<AnamnesisDraft> {
  const text = transcriptionText.trim()

  if (!text) throw new GeminiError(EMPTY_DICTATION_MESSAGE)

  const transcript =
    text.length > MAX_TRANSCRIPT_CHARS ? `${text.slice(0, MAX_TRANSCRIPT_CHARS)}…` : text

  const parsed = await requestGeminiJson({
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt: `Dictado del odontólogo:\n"""\n${transcript}\n"""`,
    schema: ANAMNESIS_SCHEMA,
  })

  return normalizeDraft(parsed)
}

