import { formatAppointmentTime } from '../features/appointments/appointment-dates'
import type {
  AppointmentPatient,
  AppointmentWithPatient,
} from '../features/appointments/appointment-types'

/**
 * Recordatorios de WhatsApp a través de **Evolution API**.
 *
 * La instancia (`VITE_EVOLUTION_INSTANCE`) ya está conectada al WhatsApp de la
 * clínica en el VPS, así que la app no abre el chat: envía el mensaje por HTTP
 * y el paciente lo recibe en su teléfono. El endpoint es:
 *
 * `POST {VITE_EVOLUTION_API_URL}/message/sendText/{VITE_EVOLUTION_INSTANCE}`
 * con el header `apikey` y el body `{ number, text }`.
 *
 * Tres detalles del servidor que condicionan este archivo:
 * - `number` tiene que ser un string en formato internacional **sin** `+`,
 *   espacios ni guiones (`595981123456`); de eso se encarga
 *   `toParaguayWhatsAppNumber()`.
 * - Una respuesta correcta llega con `201 Created` y el mensaje creado.
 * - Los errores llegan como `{ status, error, response: { message } }`, donde
 *   `message` puede ser un string o un arreglo anidado; se aplanan para mostrar
 *   un texto útil en la interfaz.
 */

export const CLINIC_NAME = 'AD Clinic'

/** URL del servidor, clave de la API y nombre de la instancia conectada. */
export type EvolutionConfig = {
  baseUrl: string
  apiKey: string
  instance: string
}

/** Tope de espera de la API: si el VPS no responde, la agenda no queda colgada. */
const REQUEST_TIMEOUT_MS = 20_000

const MISSING_ENV_MESSAGE =
  'Falta configurar Evolution API. Definí VITE_EVOLUTION_API_URL, VITE_EVOLUTION_API_KEY y VITE_EVOLUTION_INSTANCE en el .env y reiniciá el servidor.'

const CONNECTION_MESSAGE =
  'No se pudo conectar con Evolution API. Revisá la conexión a internet, que el servidor esté activo y que CORS permita el dominio de la clínica.'

function readEnv(value: string | undefined): string {
  return value?.trim() ?? ''
}

/**
 * Configuración leída de `import.meta.env` (solo variables `VITE_*`).
 * Devuelve `null` si falta alguna de las tres, así la agenda puede avisar en
 * lugar de fallar al importar el módulo.
 */
export function getEvolutionConfig(): EvolutionConfig | null {
  const baseUrl = readEnv(import.meta.env.VITE_EVOLUTION_API_URL).replace(/\/+$/, '')
  const apiKey = readEnv(import.meta.env.VITE_EVOLUTION_API_KEY)
  const instance = readEnv(import.meta.env.VITE_EVOLUTION_INSTANCE)

  if (!baseUrl || !apiKey || !instance) return null

  return { baseUrl, apiKey, instance }
}

/** `true` si la app tiene URL, clave e instancia para enviar mensajes. */
export function isWhatsAppConfigured(): boolean {
  return getEvolutionConfig() !== null
}

const MIXED_CONTENT_MESSAGE =
  'La app se sirve por HTTPS y Evolution API está en HTTP: el navegador bloquea esa petición (contenido mixto). Usá una URL `https://` en VITE_EVOLUTION_API_URL — por ejemplo el túnel de Cloudflare — y volvé a compilar.'

/**
 * `true` cuando la página va por HTTPS pero la API está en HTTP.
 *
 * Los navegadores bloquean ese `fetch` antes de salir a la red, así que
 * conviene detectarlo para avisar con un mensaje entendible en lugar de dejar
 * que falle como «no se pudo conectar».
 */
export function isMixedContentBlocked(): boolean {
  if (typeof window === 'undefined') return false

  const config = getEvolutionConfig()

  if (!config) return false

  return window.location.protocol === 'https:' && /^http:\/\//i.test(config.baseUrl)
}

/** Estado del envío automático, tal como lo muestra la agenda. */
export type WhatsAppStatus = {
  /** `true` solo si la agenda puede enviar recordatorios desde el navegador. */
  ready: boolean
  /** Aviso para el banner de la agenda (`null` si todo está en orden). */
  warning: string | null
}

/**
 * Resume por qué el envío automático puede estar desactivado: falta de
 * variables o mezcla de HTTP/HTTPS. La agenda muestra `warning` como banner y
 * deja el botón manual de WhatsApp siempre disponible.
 */
export function getWhatsAppStatus(): WhatsAppStatus {
  const config = getEvolutionConfig()

  if (!config) {
    return {
      ready: false,
      warning:
        'El envío automático de recordatorios está desactivado: falta configurar Evolution API (`VITE_EVOLUTION_API_URL`, `VITE_EVOLUTION_API_KEY` y `VITE_EVOLUTION_INSTANCE` en el `.env`). Mientras tanto, el botón de chat abre WhatsApp Web con el mensaje escrito.',
    }
  }

  if (isMixedContentBlocked()) {
    return { ready: false, warning: MIXED_CONTENT_MESSAGE }
  }

  return { ready: true, warning: null }
}


/**
 * Teléfono paraguayo → número de WhatsApp.
 *
 * `0981 123 456`, `0971 456 789`, `+595 981 123 456` y `595-981-123456`
 * terminan todos en `595981123456`: se quitan espacios, guiones y paréntesis,
 * se descarta el prefijo internacional duplicado y los ceros iniciales.
 *
 * Devuelve `null` si no quedan 8 o 9 dígitos nacionales: un número truncado
 * haría que Evolution API rechace el envío (o escriba a otra persona).
 */
export function toParaguayWhatsAppNumber(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D+/g, '')

  if (!digits) return null

  // `00595...` es el prefijo internacional escrito a mano; `595...`, el normalizado.
  const withoutIntlPrefix = digits.startsWith('00') ? digits.slice(2) : digits
  const national = withoutIntlPrefix.startsWith('595')
    ? withoutIntlPrefix.slice(3)
    : withoutIntlPrefix

  // Los móviles se guardan con 0 inicial (`0981 123 456`): no viaja a WhatsApp.
  const local = national.replace(/^0+/, '')

  // Móvil: 9 dígitos (`981 123 456`). Fijo con código de área: 8 (`21 123 456`).
  if (!/^\d{8,9}$/.test(local)) return null

  return `595${local}`
}

/** Teléfono principal del paciente y, si no sirve, el alternativo. */
export function getWhatsAppNumber(
  patient: AppointmentPatient | null | undefined,
): string | null {
  if (!patient) return null

  return toParaguayWhatsAppNumber(patient.phone) ?? toParaguayWhatsAppNumber(patient.phone_alt)
}

const REMINDER_DATE = new Intl.DateTimeFormat('es-PY', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

/** `jueves 5 de noviembre` en la hora local del navegador. */
export function formatReminderDate(startsAt: string): string {
  const date = new Date(startsAt)

  if (Number.isNaN(date.getTime())) return '—'

  return REMINDER_DATE.format(date)
}

export type AppointmentReminderOptions = {
  /**
   * Profesional que atiende la cita, por ejemplo `Dra. Ana López`. La agenda
   * todavía no guarda el nombre (`appointments.dentist_id` es el UUID del
   * odontólogo), así que si no se pasa, el mensaje omite esa frase.
   */
  professionalName?: string | null
  /** Tiempo máximo de espera de Evolution API (ms). */
  timeoutMs?: number
}

export type AppointmentReminderResult = {
  /** Número normalizado al que salió el mensaje (`595981123456`). */
  number: string
  /** Texto enviado, tal cual lo recibió el paciente. */
  text: string
  /** `id` del mensaje según Evolution API (`null` si no lo devolvió). */
  messageId: string | null
  /** Momento del envío en ISO, para `appointments.reminder_sent_at`. */
  sentAt: string
}

/** Fallo de envío con el `status` HTTP de Evolution API (`null` si fue de red). */
export class WhatsAppError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'WhatsAppError'
    this.status = status
  }
}

/**
 * Texto del recordatorio que definió la clínica: saludo con el nombre del
 * paciente, fecha y hora en la hora local, profesional y las respuestas
 * numéricas que el paciente debe enviar.
 */
export function buildAppointmentReminderText(
  appointment: Pick<AppointmentWithPatient, 'starts_at'>,
  patient: AppointmentPatient | null | undefined,
  options: AppointmentReminderOptions = {},
): string {
  const firstName = patient?.first_name?.trim() || 'paciente'
  const date = formatReminderDate(appointment.starts_at)
  const time = formatAppointmentTime(appointment.starts_at)
  const professional = options.professionalName?.trim()
  // Sin profesional conocido la frase queda igual de natural: «… a las 09:30.»
  const who = professional ? ` con ${professional}` : ''

  return [
    `Hola ${firstName}, te recordamos tu cita en *${CLINIC_NAME}* el día ${date} a las ${time}${who}.`,
    '',
    'Por favor responde *1* para confirmar tu asistencia o *2* para reagendar.',
  ].join('\n')
}

type EvolutionErrorBody = {
  status?: number
  error?: unknown
  message?: unknown
  response?: { message?: unknown }
}

/** Aplana las formas de error de Evolution (`error`, `message`, `response.message`). */
function collectErrorMessages(value: unknown, depth = 0): string[] {
  if (depth > 3 || value == null) return []

  if (typeof value === 'string') {
    const trimmed = value.trim()

    return trimmed ? [trimmed] : []
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectErrorMessages(item, depth + 1))
  }

  if (typeof value === 'object') {
    const candidate = value as EvolutionErrorBody

    return [
      ...collectErrorMessages(candidate.error, depth + 1),
      ...collectErrorMessages(candidate.message, depth + 1),
      ...collectErrorMessages(candidate.response?.message, depth + 1),
    ]
  }

  return []
}

/** Motivos HTTP genéricos que no aportan nada al usuario. */
const GENERIC_HTTP_REASONS = new Set([
  'bad request',
  'unauthorized',
  'forbidden',
  'not found',
  'internal server error',
  'service unavailable',
])

/**
 * Detalle útil del error.
 *
 * Evolution devuelve `{ status, error: 'Bad Request', response: { message } }`:
 * `error` es solo el motivo HTTP y el detalle real viaja en `response.message`
 * (a veces anidado en arreglos), así que se busca en ese orden y se descartan
 * los motivos genéricos.
 */
function getErrorDetail(body: unknown): string | null {
  if (typeof body === 'string') {
    const trimmed = body.trim()

    return trimmed && !GENERIC_HTTP_REASONS.has(trimmed.toLowerCase()) ? trimmed : null
  }

  if (!body || typeof body !== 'object') return null

  const candidate = body as EvolutionErrorBody
  const messages = [
    ...collectErrorMessages(candidate.response?.message),
    ...collectErrorMessages(candidate.message),
    ...collectErrorMessages(candidate.error),
  ]

  return messages.find((text) => !GENERIC_HTTP_REASONS.has(text.toLowerCase())) ?? null
}

function describeHttpFailure(status: number, body: unknown): string {
  if (status === 401 || status === 403) {
    return 'Evolution API rechazó la petición: revisá que VITE_EVOLUTION_API_KEY sea la clave de la API.'
  }

  if (status === 404) {
    return 'Evolution API no encontró la instancia configurada. Revisá VITE_EVOLUTION_INSTANCE.'
  }

  if (status >= 500) {
    return `Evolution API respondió con un error interno (${status}). Revisá el estado de la instancia en el VPS.`
  }

  const detail = getErrorDetail(body)

  if (detail) return `No se pudo enviar el recordatorio: ${detail}`

  return `No se pudo enviar el recordatorio por WhatsApp (HTTP ${status}).`
}

type EvolutionSendResponse = {
  key?: { id?: string | null }
  id?: string | null
  messageId?: string | null
}

function extractMessageId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null

  const candidate = body as EvolutionSendResponse

  return candidate.key?.id ?? candidate.messageId ?? candidate.id ?? null
}


export type WhatsAppTextInput = {
  /** Número internacional limpio (`595981123456`). */
  number: string
  /** Texto plano; admite el formato de WhatsApp (`*negrita*`, saltos de línea). */
  text: string
}

export type WhatsAppTextResult = {
  messageId: string | null
  /** Body que devolvió Evolution API (por si hace falta depurar). */
  response: unknown
}

/**
 * Envío de texto de bajo nivel contra Evolution API.
 *
 * Se separa de `sendAppointmentReminder` para reutilizarlo cuando haga falta
 * otro mensaje (confirmaciones, avisos de caja) sin duplicar la petición.
 */
export async function sendWhatsAppText(
  { number, text }: WhatsAppTextInput,
  { timeoutMs = REQUEST_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<WhatsAppTextResult> {
  const config = getEvolutionConfig()

  if (!config) throw new WhatsAppError(MISSING_ENV_MESSAGE)

  // Contenido mixto: el navegador cortaría el `fetch` sin dar detalle.
  if (isMixedContentBlocked()) throw new WhatsAppError(MIXED_CONTENT_MESSAGE)

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new WhatsAppError(
      'Sin conexión a internet: el recordatorio no se pudo enviar. Volvé a intentar cuando estés en línea.',
    )
  }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  let response: Response

  try {
    response = await fetch(`${config.baseUrl}/message/sendText/${config.instance}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.apiKey,
      },
      body: JSON.stringify({ number, text }),
      signal: controller.signal,
    })
  } catch {
    // `fetch` no distingue CORS, DNS o servidor caído: el mensaje cubre los tres.
    throw new WhatsAppError(
      controller.signal.aborted
        ? 'Evolution API tardó demasiado en responder. Volvé a intentar en unos segundos.'
        : CONNECTION_MESSAGE,
    )
  } finally {
    window.clearTimeout(timeout)
  }

  const raw = await response.text().catch(() => '')
  let body: unknown = null

  if (raw) {
    try {
      body = JSON.parse(raw)
    } catch {
      body = raw
    }
  }

  if (!response.ok) {
    throw new WhatsAppError(describeHttpFailure(response.status, body), response.status)
  }

  return { messageId: extractMessageId(body), response: body }
}

/**
 * Envía el recordatorio de una cita al WhatsApp del paciente.
 *
 * Lanza `WhatsAppError` con un mensaje listo para mostrar si falta
 * configuración, el teléfono no es válido, no hay red o la API responde con
 * error. Al volver bien, la agenda marca `reminder_sent_at` con `sentAt`.
 */
export async function sendAppointmentReminder(
  appointment: AppointmentWithPatient,
  patient: AppointmentPatient | null = appointment.patient,
  options: AppointmentReminderOptions = {},
): Promise<AppointmentReminderResult> {
  const number = getWhatsAppNumber(patient)

  if (!number) {
    throw new WhatsAppError(
      'El paciente no tiene un teléfono válido para WhatsApp. Actualizá su ficha con un móvil paraguayo (0981 123 456).',
    )
  }

  const text = buildAppointmentReminderText(appointment, patient, options)
  const { messageId } = await sendWhatsAppText({ number, text }, { timeoutMs: options.timeoutMs })

  return { number, text, messageId, sentAt: new Date().toISOString() }
}

