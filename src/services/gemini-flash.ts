/**
 * Cliente mínimo de **Gemini Flash con JSON Mode**.
 *
 * Lo comparten los asistentes de voz de la app (anamnesis e odontograma): cada
 * uno define su propio `systemInstruction` y su esquema, y acá vive lo común:
 *
 * - La API key (`VITE_GEMINI_API_KEY`) viaja en el header `x-goog-api-key` y no
 *   en `?key=`, para que no quede registrada en logs de proxies ni en el
 *   historial del navegador.
 * - Cadena de modelos: se prueba el configurado en `VITE_GEMINI_MODEL`, el
 *   último que funcionó, el alias `gemini-flash-latest` y una lista de
 *   respaldos. Un `404` significa «ese modelo no está disponible para esta
 *   clave» y se pasa al siguiente sin molestar al usuario.
 * - Timeout con `AbortController`: sin esto el botón queda «Procesando…» para
 *   siempre.
 * - Los errores HTTP se traducen a mensajes en español listos para mostrar.
 *
 * Aviso de seguridad: `VITE_GEMINI_API_KEY` viaja en el bundle (Vite solo
 * inyecta las variables `VITE_*` en el navegador). Es una clave de **uso
 * interno de la clínica**, no un secreto de servidor: conviene una clave
 * exclusiva, con cuota limitada, restringida por HTTP referrers, y rotarla si
 * se filtra. Los textos dictados son datos del paciente: no se guardan.
 */

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
 * anteriores. Solo se prueban si el modelo anterior responde `404`.
 */
const FALLBACK_GEMINI_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-1.5-flash']

/** Último modelo que funcionó: evita repetir la cadena de respaldos. */
let workingModel: string | null = null

/** Tope de espera de Gemini: sin esto la petición puede quedar colgada. */
const REQUEST_TIMEOUT_MS = 30_000

export const GEMINI_MISSING_KEY_MESSAGE =
  'Falta la API key de Gemini: agregá VITE_GEMINI_API_KEY en el .env (Google AI Studio → «Get API key») y reiniciá el servidor.'

export const GEMINI_TIMEOUT_MESSAGE =
  'Gemini tardó demasiado en responder. Revisá la conexión y volvé a intentar.'

export const GEMINI_CONNECTION_MESSAGE =
  'No se pudo conectar con Gemini. Revisá la conexión a internet (o si un bloqueador/proxy está cortando la petición) y volvé a intentar.'

export const GEMINI_INVALID_KEY_MESSAGE =
  'Gemini rechazó la API key. Generá una nueva en Google AI Studio y actualizá VITE_GEMINI_API_KEY en el .env.'

export const GEMINI_QUOTA_MESSAGE =
  'Se alcanzó el límite de uso de Gemini para esta clave. Esperá un minuto y volvé a intentar, o usá otra API key.'

export const GEMINI_BLOCKED_MESSAGE =
  'Gemini bloqueó la respuesta por sus filtros de seguridad. Revisá el dictado y cargá los datos a mano.'

export const GEMINI_OFFLINE_MESSAGE =
  'Sin conexión a internet: Gemini no puede procesar el dictado. Volvé a intentar cuando estés en línea.'

/** Error de Gemini, con mensaje listo para mostrar y el HTTP status si lo hubo. */
export class GeminiError extends Error {
  /** HTTP status de Gemini (`null` para errores de red o de configuración). */
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'GeminiError'
    this.status = status
  }
}

/** Clave configurada (vacía si falta). */
export function readGeminiApiKey(): string {
  return (import.meta.env.VITE_GEMINI_API_KEY ?? '').trim()
}

/** `true` cuando hay API key: sin ella solo funciona el parser local. */
export function isGeminiConfigured(): boolean {
  return readGeminiApiKey().length > 0
}

/** Modelos a intentar, en orden: configurado → último bueno → por defecto → respaldos. */
export function getGeminiModelCandidates(): string[] {
  const configured = (import.meta.env.VITE_GEMINI_MODEL ?? '').trim()

  return [...new Set([configured, workingModel, DEFAULT_GEMINI_MODEL, ...FALLBACK_GEMINI_MODELS])]
    .filter((model): model is string => Boolean(model))
}


type GeminiPart = { text?: string }
type GeminiCandidate = { content?: { parts?: GeminiPart[] }; finishReason?: string }
type GeminiErrorBody = { code?: number; message?: string; status?: string }
type GeminiResponse = {
  candidates?: GeminiCandidate[]
  promptFeedback?: { blockReason?: string }
  error?: GeminiErrorBody
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
function describeHttpFailure(status: number, body: GeminiResponse | null): GeminiError {
  const detail = body?.error?.message?.trim() || ''

  if (status === 400 || status === 401 || status === 403) {
    const isKeyProblem = /api[ _-]?key|permission|credential|unauthori[sz]ed/i.test(detail)

    return new GeminiError(
      isKeyProblem
        ? GEMINI_INVALID_KEY_MESSAGE
        : `Gemini rechazó la solicitud${detail ? `: ${detail}` : ` (HTTP ${status})`}. Revisá el dictado y volvé a intentar.`,
      status,
    )
  }

  if (status === 429) return new GeminiError(GEMINI_QUOTA_MESSAGE, status)

  if (status === 404) {
    // Se usa para detectar «el modelo ya no existe» y probar el siguiente.
    return new GeminiError(
      detail || 'El modelo de Gemini configurado no está disponible para esta API key.',
      status,
    )
  }

  if (status >= 500) {
    return new GeminiError(
      `Gemini respondió con un error interno (HTTP ${status}). Volvé a intentar en unos segundos.`,
      status,
    )
  }

  return new GeminiError(
    `No se pudo procesar el dictado con Gemini${detail ? `: ${detail}` : ` (HTTP ${status})`}.`,
    status,
  )
}

export type GeminiJsonRequest = {
  /** Rol, reglas y tono del asistente. */
  systemInstruction: string
  /** Turno del usuario (el dictado y su contexto). */
  prompt: string
  /** Esquema OpenAPI de la respuesta (tipos en MAYÚSCULAS, como en `v1beta`). */
  schema: Record<string, unknown>
  /** Creatividad; con JSON Mode conviene 0.1. */
  temperature?: number
  maxOutputTokens?: number
  timeoutMs?: number
}

/**
 * Una llamada a `generateContent` con JSON Mode sobre un modelo concreto.
 * Devuelve el JSON ya parseado (sin normalizar: cada feature sabe qué espera).
 */
async function requestWithModel(
  model: string,
  apiKey: string,
  request: GeminiJsonRequest,
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = window.setTimeout(
    () => controller.abort(),
    request.timeoutMs ?? REQUEST_TIMEOUT_MS,
  )

  let response: Response

  try {
    response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
        generationConfig: {
          temperature: request.temperature ?? 0.1,
          maxOutputTokens: request.maxOutputTokens ?? 2048,
          responseMimeType: 'application/json',
          responseSchema: request.schema,
        },
      }),
      signal: controller.signal,
    })
  } catch {
    throw new GeminiError(controller.signal.aborted ? GEMINI_TIMEOUT_MESSAGE : GEMINI_CONNECTION_MESSAGE)
  } finally {
    window.clearTimeout(timeout)
  }

  const body = (await readJsonBody(response)) as GeminiResponse | null

  if (!response.ok) throw describeHttpFailure(response.status, body)

  if (body?.promptFeedback?.blockReason) {
    throw new GeminiError(GEMINI_BLOCKED_MESSAGE, response.status)
  }

  const candidate = body?.candidates?.[0]

  if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'PROHIBITED_CONTENT') {
    throw new GeminiError(GEMINI_BLOCKED_MESSAGE, response.status)
  }

  const rawText = (candidate?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim()

  if (!rawText) {
    throw new GeminiError(
      'Gemini no devolvió datos para este dictado. Revisá el texto y volvé a intentar.',
      response.status,
    )
  }

  try {
    return JSON.parse(rawText) as unknown
  } catch {
    throw new GeminiError(
      'Gemini devolvió una respuesta que no es JSON válido. Volvé a intentar en unos segundos.',
      response.status,
    )
  }
}

/**
 * Envía el dictado a Gemini y devuelve el JSON del esquema.
 *
 * Lanza `GeminiError` con un mensaje listo para mostrar si falta la API key, no
 * hay red, la clave no sirve, se agotó la cuota o el modelo dejó de existir. Si
 * un modelo responde `404` se prueba con el siguiente y se recuerda el que
 * funcionó; cualquier otro error se propaga sin reintentos para no duplicar
 * llamadas (ni gastar cuota).
 */
export async function requestGeminiJson(request: GeminiJsonRequest): Promise<unknown> {
  const apiKey = readGeminiApiKey()

  if (!apiKey) throw new GeminiError(GEMINI_MISSING_KEY_MESSAGE)

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new GeminiError(GEMINI_OFFLINE_MESSAGE)
  }

  let lastModelError: GeminiError | null = null

  for (const model of getGeminiModelCandidates()) {
    try {
      const parsed = await requestWithModel(model, apiKey, request)

      workingModel = model
      return parsed
    } catch (error) {
      if (error instanceof GeminiError && error.status === 404) {
        // Modelo retirado para esta clave: se intenta con el siguiente.
        lastModelError = error
        continue
      }

      throw error
    }
  }

  throw new GeminiError(
    `Ningún modelo de Gemini disponible respondió (${getGeminiModelCandidates().join(', ')}). ${
      lastModelError?.message ?? ''
    } Definí un modelo válido en VITE_GEMINI_MODEL.`.trim(),
    lastModelError?.status ?? 404,
  )
}

