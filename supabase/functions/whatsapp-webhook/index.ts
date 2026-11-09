// =============================================================================
// AD Clinic · Edge Function `whatsapp-webhook`
// -----------------------------------------------------------------------------
// Recibe los eventos de Evolution API de la instancia `ad-clinic` y aplica la
// respuesta del paciente al recordatorio de su cita:
//
//   «1» → la cita queda *confirmada*.
//   «2» → la cita queda *a reagendar* (`reschedule_requested`) y recepción la ve
//         marcada en la agenda para llamar al paciente.
//
// La escritura la resuelve `rpc('apply_appointment_response')` (migración
// 20261104120200): es atómica e idempotente por `wa_message_id`, así que los
// reintentos de Evolution nunca duplican el cambio de estado.
//
// Seguridad:
// - Se despliega con `verify_jwt = false` (supabase/config.toml): quien llama es
//   el VPS, no un usuario logueado. La autenticación es un secreto compartido
//   que viaja en el header `x-webhook-secret`.
// - Evolution reenvía su `apikey` dentro del payload: se descarta, nunca se
//   guarda ni se loguea.
// - Un secreto inválido responde 401, que Evolution no reintenta (400, 401, 403,
//   404 y 422 están en su lista de códigos no reintentables).
// - Todo lo demás responde 200 para no disparar reintentos por casos de negocio
//   (texto desconocido, paciente inexistente, mensaje propio del bot).
//
// Deploy:
//   supabase functions deploy whatsapp-webhook --no-verify-jwt
// Secretos:
//   supabase secrets set WHATSAPP_WEBHOOK_SECRET=... EVOLUTION_API_URL=...
//     EVOLUTION_API_KEY=... EVOLUTION_INSTANCE=ad-clinic
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.)
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

/** Mismo nombre que `src/services/whatsapp.ts`: el acuse sale con la marca de la clínica. */
const CLINIC_NAME = 'AD Clinic'

/** El acuse no puede depender de la zona del servidor: Paraguay es UTC-3 fijo. */
const CLINIC_TIME_ZONE = 'America/Asuncion'

const SECRET_HEADER = 'x-webhook-secret'

/** Un secreto corto no protege nada: es la única barrera del endpoint. */
const MIN_SECRET_LENGTH = 24

/** Tope del texto que se guarda del mensaje recibido. */
const MAX_BODY_LENGTH = 500

type Choice = 'confirm' | 'reschedule' | 'unknown'

type Json = Record<string, unknown>

function json(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function readEnv(name: string): string {
  return (Deno.env.get(name) ?? '').trim()
}

function redact(phone: string): string {
  return phone.length <= 4 ? '****' : `${phone.slice(0, 4)}****${phone.slice(-2)}`
}

const DATE_FORMATTER = new Intl.DateTimeFormat('es-PY', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: CLINIC_TIME_ZONE,
})

const TIME_FORMATTER = new Intl.DateTimeFormat('es-PY', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: CLINIC_TIME_ZONE,
})

function formatWhen(startsAt: string | undefined): string {
  if (!startsAt) return 'tu próxima cita'

  const date = new Date(startsAt)

  if (Number.isNaN(date.getTime())) return 'tu próxima cita'

  return `el ${DATE_FORMATTER.format(date)} a las ${TIME_FORMATTER.format(date)}`
}

// -----------------------------------------------------------------------------
// Lectura del evento de Evolution API
// -----------------------------------------------------------------------------

type InboundMessage = {
  messageId: string
  /** Número tal como llega de WhatsApp: `595981123456`. */
  phone: string
  text: string
  pushName: string
  messageType: string
}

/**
 * Algunos mensajes llegan envueltos (`ephemeralMessage`, `viewOnceMessage`…).
 * Se desenvuelven hasta tres niveles para encontrar el texto.
 */
function unwrapMessage(message: Json): Json {
  let current = message

  for (let depth = 0; depth < 3; depth += 1) {
    const wrapper =
      (current.ephemeralMessage as { message?: Json } | undefined)?.message ??
      (current.viewOnceMessage as { message?: Json } | undefined)?.message ??
      (current.viewOnceMessageV2 as { message?: Json } | undefined)?.message ??
      (current.documentWithCaptionMessage as { message?: Json } | undefined)?.message

    if (!wrapper) return current

    current = wrapper
  }

  return current
}

/** Texto del mensaje, venga como texto plano, respuesta de botón o de lista. */
function extractText(message: unknown): string {
  if (!message || typeof message !== 'object') return ''

  const body = unwrapMessage(message as Json)
  const candidates: unknown[] = [
    body.conversation,
    (body.extendedTextMessage as { text?: string } | undefined)?.text,
    (body.buttonsResponseMessage as { selectedDisplayText?: string } | undefined)?.selectedDisplayText,
    (body.templateButtonReplyMessage as { selectedDisplayText?: string } | undefined)?.selectedDisplayText,
    (body.listResponseMessage as { singleSelectReply?: { selectedRowId?: string } } | undefined)
      ?.singleSelectReply?.selectedRowId,
    (body.listResponseMessage as { title?: string } | undefined)?.title,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }

  return ''
}

/** Minúsculas, sin acentos y sin signos: «¡Sí, voy!» → «si voy». */
function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Interpreta la respuesta del paciente. El recordatorio pide «1» o «2», pero se
 * toleran las formas naturales de contestar por WhatsApp.
 */
function parseChoice(text: string): Choice {
  const normalized = normalizeText(text)

  if (!normalized) return 'unknown'

  // «1», «1.», «1 gracias» sí; «11» o «12» no.
  if (/^1(\s|$)/.test(normalized)) return 'confirm'
  if (/^2(\s|$)/.test(normalized)) return 'reschedule'

  if (/^(confirmo|confirmar|confirmado|si|dale|ok|asisto|asistire|voy|presente)\b/.test(normalized)) {
    return 'confirm'
  }

  if (/^(reagendar|reagendo|reprogramar|reprogramo|cambiar|cambio|mover|no puedo|no voy)\b/.test(normalized)) {
    return 'reschedule'
  }

  return 'unknown'
}

/** Mensaje de confirmación que recibe el paciente por WhatsApp. */
function buildAckText(choice: Choice, patientName: string, startsAt?: string): string {
  const name = patientName.trim() || 'paciente'

  if (choice === 'reschedule') {
    return [
      `Gracias, ${name}. Anotamos que querés reagendar tu cita ${formatWhen(startsAt)}.`,
      `En breve te escribimos desde *${CLINIC_NAME}* para coordinar un nuevo horario.`,
    ].join('\n')
  }

  return [
    `¡Gracias, ${name}! Tu cita ${formatWhen(startsAt)} en *${CLINIC_NAME}* quedó confirmada.`,
    'Te esperamos.',
  ].join('\n')
}

// -----------------------------------------------------------------------------
// Filtros del evento
// -----------------------------------------------------------------------------

type EventRead =
  | { kind: 'skip'; reason: string }
  | { kind: 'message'; message: InboundMessage; payloadPreview: Json }

/**
 * Descarta lo que no es una respuesta de un paciente: eventos de otro tipo,
 * mensajes del propio bot (`fromMe`), grupos, canales y mensajes sin texto.
 */
function readEvent(body: Json): EventRead {
  const rawEvent = typeof body.event === 'string' ? body.event : ''
  const event = rawEvent.replace(/[.-]/g, '_').toUpperCase()

  if (event !== 'MESSAGES_UPSERT') {
    return { kind: 'skip', reason: `event_ignored:${event || 'unknown'}` }
  }

  const data = (Array.isArray(body.data) ? body.data[0] : body.data) as Json | undefined

  if (!data) return { kind: 'skip', reason: 'empty_payload' }

  const key = (data.key ?? {}) as { id?: unknown; remoteJid?: unknown; fromMe?: unknown }
  const remoteJid = typeof key.remoteJid === 'string' ? key.remoteJid : ''

  if (key.fromMe === true) return { kind: 'skip', reason: 'from_me' }
  if (!remoteJid.endsWith('@s.whatsapp.net')) return { kind: 'skip', reason: 'not_a_contact' }

  const phone = remoteJid.split('@')[0].replace(/\D/g, '')

  if (!phone) return { kind: 'skip', reason: 'no_phone' }

  const text = extractText(data.message)

  if (!text) return { kind: 'skip', reason: 'no_text' }

  const hasMessageId = typeof key.id === 'string' && key.id.length > 0
  const messageId = hasMessageId ? (key.id as string) : crypto.randomUUID()
  const pushName = typeof data.pushName === 'string' ? data.pushName : ''
  const messageType = typeof data.messageType === 'string' ? data.messageType : 'unknown'

  return {
    kind: 'message',
    message: { messageId, phone, text, pushName, messageType },
    // Payload saneado: sin `apikey`, `server_url` ni tokens de Evolution API.
    payloadPreview: {
      event: rawEvent,
      instance: body.instance ?? null,
      messageId,
      remoteJid,
      pushName,
      messageType,
      text: text.slice(0, MAX_BODY_LENGTH),
      messageTimestamp: data.messageTimestamp ?? null,
    },
  }
}

// -----------------------------------------------------------------------------
// Acuse al paciente (mismo endpoint que usa la agenda para los recordatorios)
// -----------------------------------------------------------------------------
async function sendText(number: string, text: string): Promise<void> {
  const baseUrl = readEnv('EVOLUTION_API_URL').replace(/\/+$/, '')
  const apiKey = readEnv('EVOLUTION_API_KEY')
  const instance = readEnv('EVOLUTION_INSTANCE') || 'ad-clinic'

  if (!baseUrl || !apiKey) {
    console.warn('[whatsapp-webhook] sin EVOLUTION_API_URL/EVOLUTION_API_KEY: no se envía el acuse.')
    return
  }

  const response = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instance)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: apiKey },
    body: JSON.stringify({ number, text }),
  })

  if (!response.ok) {
    console.error(`[whatsapp-webhook] Evolution API rechazó el acuse (HTTP ${response.status}).`)
  }
}

type EdgeRuntimeLike = { waitUntil: (promise: Promise<unknown>) => void }

/**
 * Deja el acuse corriendo después de responderle a Evolution: el webhook tiene
 * que contestar rápido para no acumular reintentos.
 */
function runInBackground(task: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime

  if (runtime?.waitUntil) {
    runtime.waitUntil(task)
    return
  }

  void task
}

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------

type RpcResult = {
  applied?: boolean
  reason?: string
  status?: string
  starts_at?: string
  patient_name?: string
  appointment_id?: string
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Health check para probar el despliegue sin tocar datos.
  if (req.method === 'GET') {
    return json({ ok: true, service: 'whatsapp-webhook' })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Método no soportado.' }, 405)
  }

  const secret = readEnv('WHATSAPP_WEBHOOK_SECRET')

  if (secret.length < MIN_SECRET_LENGTH) {
    console.error(
      '[whatsapp-webhook] WHATSAPP_WEBHOOK_SECRET ausente o demasiado corto: no se aceptan eventos.',
    )
    return json({ error: 'Webhook sin configurar.' }, 503)
  }

  if ((req.headers.get(SECRET_HEADER) ?? '').trim() !== secret) {
    console.warn('[whatsapp-webhook] Secreto inválido: evento descartado.')
    return json({ error: 'No autorizado.' }, 401)
  }

  const supabaseUrl = readEnv('SUPABASE_URL')
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[whatsapp-webhook] Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.')
    return json({ error: 'Configuración incompleta.' }, 503)
  }

  let body: Json

  try {
    body = (await req.json()) as Json
  } catch {
    return json({ error: 'Cuerpo inválido: se esperaba JSON.' }, 400)
  }

  const read = readEvent(body)

  if (read.kind === 'skip') {
    return json({ ok: true, applied: false, reason: read.reason })
  }

  const { message, payloadPreview } = read
  const choice = parseChoice(message.text)
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await supabase.rpc('apply_appointment_response', {
    p_wa_message_id: message.messageId,
    p_phone: message.phone,
    p_body: message.text.slice(0, MAX_BODY_LENGTH),
    p_choice: choice,
    p_payload: payloadPreview,
  })

  if (error) {
    // 500 para que Evolution reintente: la función es idempotente.
    console.error(`[whatsapp-webhook] No se pudo aplicar la respuesta: ${error.message}`)
    return json({ error: 'No se pudo registrar la respuesta.' }, 500)
  }

  const result = (data ?? {}) as RpcResult

  if (!result.applied) {
    console.log(
      `[whatsapp-webhook] ${redact(message.phone)} sin cambios (${result.reason ?? 'sin motivo'}).`,
    )
    return json({ ok: true, applied: false, reason: result.reason ?? 'unknown' })
  }

  console.log(`[whatsapp-webhook] ${redact(message.phone)} → ${result.status ?? 'sin estado'}`)

  const ackText = buildAckText(choice, result.patient_name ?? message.pushName, result.starts_at)

  runInBackground(
    sendText(message.phone, ackText).catch((ackError: unknown) => {
      console.error(`[whatsapp-webhook] No se pudo enviar el acuse: ${String(ackError)}`)
    }),
  )

  return json({
    ok: true,
    applied: true,
    status: result.status ?? null,
    appointmentId: result.appointment_id ?? null,
  })
})
