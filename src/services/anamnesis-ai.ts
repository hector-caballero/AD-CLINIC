import type { AnamnesisDraft } from '../features/patients/anamnesis-types'

/**
 * Dictado por voz y estructuración con IA para la **anamnesis**.
 *
 * Dos piezas independientes:
 *
 * 1. **Transcripción** — Web Speech API nativa del navegador
 *    (`SpeechRecognition` / `webkitSpeechRecognition`). Es gratuita y no sube
 *    audio a ningún servidor propio: el navegador transcribe en streaming, así
 *    que el doctor ve el texto mientras habla.
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
// 1. Web Speech API (tipado mínimo)
//    `lib.dom` todavía no declara `SpeechRecognition`, así que se describe acá
//    solo lo que se usa. En Chrome/Edge/Safari existe con prefijo `webkit`.
// -----------------------------------------------------------------------------

type SpeechAlternative = { transcript: string; confidence: number }

type SpeechResult = { isFinal: boolean; length: number; [index: number]: SpeechAlternative }

type SpeechResultList = { length: number; [index: number]: SpeechResult }

type SpeechResultEvent = { resultIndex: number; results: SpeechResultList }

type SpeechErrorEvent = { error: string; message?: string }

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null

  const candidate = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }

  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null
}

/** `true` si el navegador puede transcribir voz (Chrome, Edge y Safari sí). */
export function isDictationSupported(): boolean {
  return getSpeechRecognition() !== null
}

/**
 * Idioma del dictado: español de Paraguay. Si el motor del navegador no tiene
 * ese locale, `es-PY` cae solo a español neutro; el vocabulario odontológico se
 * reconoce igual.
 */
const DICTATION_LANG = 'es-PY'

/** Tope de espera de Gemini: sin esto el botón queda «Procesando…» para siempre. */
const REQUEST_TIMEOUT_MS = 30_000

const MISSING_KEY_MESSAGE =
  'Falta la API key de Gemini: agregá VITE_GEMINI_API_KEY en el .env (Google AI Studio → «Get API key») y reiniciá el servidor. Podés completar la ficha a mano mientras tanto.'

const UNSUPPORTED_BROWSER_MESSAGE =
  'Este navegador no soporta dictado por voz (Web Speech API). Usá Chrome o Edge actualizados; la ficha se puede completar a mano.'

const MIC_PERMISSION_MESSAGE =
  'El navegador bloqueó el micrófono. Habilitá el permiso desde el candado de la barra de direcciones y volvé a intentar.'

const MIC_MISSING_MESSAGE = 'No se encontró un micrófono disponible. Conectá uno y volvé a intentar.'

const DICTATION_NETWORK_MESSAGE =
  'El servicio de dictado del navegador no respondió. Revisá la conexión a internet y volvé a intentar.'

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
  if (!readApiKey()) {
    return { ready: false, warning: MISSING_KEY_MESSAGE }
  }

  if (!isDictationSupported()) {
    return { ready: false, warning: UNSUPPORTED_BROWSER_MESSAGE }
  }

  return { ready: true, warning: null }
}

/** Error del dictado o de Gemini, con mensaje listo para mostrar. */
export class AnamnesisAiError extends Error {
  /** HTTP status de Gemini (`null` para errores del micrófono o del navegador). */
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'AnamnesisAiError'
    this.status = status
  }
}

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
 * Crea un dictado continuo en español.
 *
 * Chrome corta la sesión después de unos segundos de silencio (`onend`), así
 * que mientras el usuario siga dictando se reinicia sola: es lo que espera un
 * odontólogo que habla pausado. `stop()` es el único que termina de verdad.
 */
export function createAnamnesisDictation(
  handlers: AnamnesisDictationHandlers,
): AnamnesisDictation {
  const Recognition = getSpeechRecognition()

  if (!Recognition) {
    throw new AnamnesisAiError(UNSUPPORTED_BROWSER_MESSAGE)
  }

  const recognition = new Recognition()
  recognition.lang = DICTATION_LANG
  recognition.continuous = true
  recognition.interimResults = true
  recognition.maxAlternatives = 1

  let finalText = ''
  let interimText = ''
  let shouldListen = false
  let disposed = false

  const emitTranscript = () => {
    if (!disposed) handlers.onTranscript(finalText, interimText)
  }

  recognition.onresult = (event) => {
    let interim = ''

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]
      const text = result?.[0]?.transcript ?? ''

      if (result?.isFinal) {
        finalText = `${finalText} ${text}`.replace(/\s+/g, ' ').trimStart()
      } else {
        interim = `${interim} ${text}`.replace(/\s+/g, ' ').trimStart()
      }
    }

    interimText = interim
    emitTranscript()
  }

  recognition.onerror = (event) => {
    switch (event.error) {
      case 'not-allowed':
      case 'service-not-allowed':
        shouldListen = false
        handlers.onError(MIC_PERMISSION_MESSAGE)
        break
      case 'audio-capture':
        shouldListen = false
        handlers.onError(MIC_MISSING_MESSAGE)
        break
      case 'network':
        shouldListen = false
        handlers.onError(DICTATION_NETWORK_MESSAGE)
        break
      case 'no-speech':
      case 'aborted':
        // Silencio normal: `onend` decide si se reinicia la escucha.
        break
      default:
        shouldListen = false
        handlers.onError(`No se pudo dictar (${event.error}). Volvé a intentar.`)
        break
    }
  }

  recognition.onstart = () => {
    if (!disposed) handlers.onStateChange?.('listening')
  }

  recognition.onend = () => {
    if (disposed) return

    if (shouldListen) {
      // Corte automático por silencio: se retoma sin perder lo ya transcripto.
      try {
        recognition.start()
        return
      } catch {
        shouldListen = false
      }
    }

    handlers.onStateChange?.('idle')
  }

  return {
    start: () => {
      if (disposed || shouldListen) return

      shouldListen = true
      interimText = ''

      try {
        recognition.start()
        handlers.onStateChange?.('listening')
      } catch {
        // `start()` falla si la sesión ya estaba activa: no es un error real.
        shouldListen = false
      }
    },
    stop: () => {
      shouldListen = false
      interimText = ''

      try {
        recognition.stop()
      } catch {
        // Detener una sesión ya cerrada no es un error.
      }

      handlers.onStateChange?.('idle')
    },
    dispose: () => {
      disposed = true
      shouldListen = false

      try {
        recognition.abort()
      } catch {
        // Si nunca arrancó, `abort()` puede lanzar: se ignora al cerrar.
      }
    },
  }
}

// -----------------------------------------------------------------------------
// 3. Gemini Flash (JSON Mode)
// -----------------------------------------------------------------------------

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Modelo por defecto: el alias `-latest` que Google mantiene apuntando al Flash
 * estable vigente. Es la opción que no se rompe cuando retiran una versión (en
 * este proyecto el `gemini-1.5-flash` original ya no existe).
 *
 * Se puede fijar otro con `VITE_GEMINI_MODEL`.
 */
const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest'

/**
 * Respaldos para claves/proyectos que todavía tienen acceso a versiones
 * anteriores. Solo se prueban si el modelo anterior responde `404` (modelo no
 * disponible para esa API key).
 */
const FALLBACK_GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-1.5-flash']

/** Último modelo que funcionó: evita repetir la cadena de respaldos. */
let workingModel: string | null = null

/** Tope de texto que se envía a Gemini (un dictado real ronda los 600–1200). */
const MAX_TRANSCRIPT_CHARS = 4000

function readApiKey(): string {
  return (import.meta.env.VITE_GEMINI_API_KEY ?? '').trim()
}

/** Modelos a intentar, en orden: configurado → último bueno → por defecto → respaldos. */
function getModelCandidates(): string[] {
  const configured = (import.meta.env.VITE_GEMINI_MODEL ?? '').trim()

  return [...new Set([configured, workingModel, DEFAULT_GEMINI_MODEL, ...FALLBACK_GEMINI_MODELS])]
    .filter((model): model is string => Boolean(model))
}

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

type GeminiPart = { text?: string }
type GeminiCandidate = { content?: { parts?: GeminiPart[] }; finishReason?: string }
type GeminiErrorBody = { code?: number; message?: string; status?: string }
type GeminiResponse = {
  candidates?: GeminiCandidate[]
  promptFeedback?: { blockReason?: string }
  error?: GeminiErrorBody
}

const TIMEOUT_MESSAGE =
  'Gemini tardó demasiado en responder. Revisá la conexión y volvé a intentar; mientras tanto podés completar la ficha a mano.'

const CONNECTION_MESSAGE =
  'No se pudo conectar con Gemini. Revisá la conexión a internet (o si un bloqueador/proxy está cortando la petición) y volvé a intentar.'

const EMPTY_DICTATION_MESSAGE =
  'El dictado está vacío: hablá al menos una frase y volvé a intentar.'

const INVALID_KEY_MESSAGE =
  'Gemini rechazó la API key. Generá una nueva en Google AI Studio y actualizá VITE_GEMINI_API_KEY en el .env.'

const QUOTA_MESSAGE =
  'Se alcanzó el límite de uso de Gemini para esta clave. Esperá un minuto y volvé a intentar, o usá otra API key.'

const BLOCKED_MESSAGE =
  'Gemini bloqueó la respuesta por sus filtros de seguridad. Revisá el dictado y cargá los datos a mano.'

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

async function readJsonBody(response: Response): Promise<unknown> {
  const raw = await response.text().catch(() => '')

  if (!raw) return null

  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/** Mensaje para un error HTTP de Gemini (sin exponer el cuerpo crudo). */
function describeHttpFailure(status: number, body: GeminiResponse | null): AnamnesisAiError {
  const detail = body?.error?.message?.trim() || ''

  if (status === 400 || status === 401 || status === 403) {
    const isKeyProblem = /api[ _-]?key|permission|credential|unauthori[sz]ed/i.test(detail)

    return new AnamnesisAiError(
      isKeyProblem
        ? INVALID_KEY_MESSAGE
        : `Gemini rechazó la solicitud${detail ? `: ${detail}` : ` (HTTP ${status})`}. Revisá el dictado y volvé a intentar.`,
      status,
    )
  }

  if (status === 429) return new AnamnesisAiError(QUOTA_MESSAGE, status)

  if (status === 404) {
    // Se usa para detectar «el modelo ya no existe» y probar el siguiente.
    return new AnamnesisAiError(
      detail || 'El modelo de Gemini configurado no está disponible para esta API key.',
      status,
    )
  }

  if (status >= 500) {
    return new AnamnesisAiError(
      `Gemini respondió con un error interno (HTTP ${status}). Volvé a intentar en unos segundos.`,
      status,
    )
  }

  return new AnamnesisAiError(
    `No se pudo procesar el dictado con Gemini${detail ? `: ${detail}` : ` (HTTP ${status})`}.`,
    status,
  )
}

type GeminiRequestArgs = {
  model: string
  apiKey: string
  transcript: string
}

/**
 * Una llamada a `generateContent` con JSON Mode.
 *
 * La clave viaja en el header `x-goog-api-key` (y no en `?key=`) para que no
 * quede registrada en logs de proxies ni en el historial del navegador.
 */
async function requestAnamnesisDraft({
  model,
  apiKey,
  transcript,
}: GeminiRequestArgs): Promise<AnamnesisDraft> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response

  try {
    response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: `Dictado del odontólogo:\n"""\n${transcript}\n"""` }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
          responseSchema: ANAMNESIS_SCHEMA,
        },
      }),
      signal: controller.signal,
    })
  } catch {
    throw new AnamnesisAiError(controller.signal.aborted ? TIMEOUT_MESSAGE : CONNECTION_MESSAGE)
  } finally {
    window.clearTimeout(timeout)
  }

  const body = (await readJsonBody(response)) as GeminiResponse | null

  if (!response.ok) throw describeHttpFailure(response.status, body)

  if (body?.promptFeedback?.blockReason) {
    throw new AnamnesisAiError(BLOCKED_MESSAGE, response.status)
  }

  const candidate = body?.candidates?.[0]

  if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'PROHIBITED_CONTENT') {
    throw new AnamnesisAiError(BLOCKED_MESSAGE, response.status)
  }

  const rawText = (candidate?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim()

  if (!rawText) {
    throw new AnamnesisAiError(
      'Gemini no devolvió datos para este dictado. Revisá el texto y volvé a intentar.',
      response.status,
    )
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(rawText) as unknown
  } catch {
    throw new AnamnesisAiError(
      'Gemini devolvió una respuesta que no es JSON válido. Volvé a intentar en unos segundos.',
      response.status,
    )
  }

  return normalizeDraft(parsed)
}

/**
 * Convierte el dictado en la estructura de la hoja de anamnesis.
 *
 * Lanza `AnamnesisAiError` con un mensaje listo para mostrar si falta la API
 * key, no hay red, la clave no sirve, se agotó la cuota o el modelo dejó de
 * existir. Si el primer modelo no está disponible se prueba con los respaldos
 * (`404`); cualquier otro error se propaga sin reintentos para no duplicar
 * llamadas.
 */
export async function parseAnamnesisWithGemini(
  transcriptionText: string,
): Promise<AnamnesisDraft> {
  const text = transcriptionText.trim()

  if (!text) throw new AnamnesisAiError(EMPTY_DICTATION_MESSAGE)

  const apiKey = readApiKey()

  if (!apiKey) throw new AnamnesisAiError(MISSING_KEY_MESSAGE)

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new AnamnesisAiError(
      'Sin conexión a internet: Gemini no puede procesar el dictado. Volvé a intentar cuando estés en línea.',
    )
  }

  const transcript =
    text.length > MAX_TRANSCRIPT_CHARS ? `${text.slice(0, MAX_TRANSCRIPT_CHARS)}…` : text

  let lastModelError: AnamnesisAiError | null = null

  for (const model of getModelCandidates()) {
    try {
      const draft = await requestAnamnesisDraft({ model, apiKey, transcript })

      workingModel = model
      return draft
    } catch (error) {
      if (error instanceof AnamnesisAiError && error.status === 404) {
        // Modelo retirado para esta clave: se intenta con el siguiente.
        lastModelError = error
        continue
      }

      throw error
    }
  }

  throw new AnamnesisAiError(
    `Ningún modelo de Gemini disponible respondió (${getModelCandidates().join(', ')}). ${
      lastModelError?.message ?? ''
    } Definí un modelo válido en VITE_GEMINI_MODEL.`.trim(),
    lastModelError?.status ?? 404,
  )
}
