import {
  GEMINI_MISSING_KEY_MESSAGE,
  GeminiError,
  isGeminiConfigured,
  requestGeminiJson,
} from './gemini-flash'
import type {
  OdontogramItemStatus,
  ToothSurface,
} from '../features/odontogram/odontogram-types'
import {
  ASSISTANT_STATUSES,
  ASSISTANT_SURFACES,
  type AssistantActionType,
  type AssistantDisposition,
  type AssistantFollowupDraft,
  type AssistantGuidedCommand,
  type AssistantIntent,
  type AssistantOdontogramDraft,
  type AssistantOpenTarget,
} from '../features/voice-assistant/assistant-types'

/**
 * Motor de intenciones del copiloto clínico (`VITE_GEMINI_API_KEY`).
 *
 * A diferencia del dictado del odontograma —que solo lee piezas y caras— acá el
 * modelo recibe **el contexto completo de la sesión** (ruta activa, paciente en
 * consulta, resumen del plan y siguiente paciente en sala) y devuelve una única
 * herramienta del catálogo con sus parámetros. El resultado se normaliza antes
 * de tocar cualquier servicio: nada que llegue del modelo se ejecuta sin pasar
 * por `normalizeAssistantIntent` y, si modifica datos sensibles, por la
 * confirmación del doctor.
 *
 * `parseDoctorCommandLocally` cubre los comandos más usados sin red ni costo
 * (siguiente paciente, alertas, estado de cuenta, modo guía, cobro y factura).
 */

export type DoctorAssistantPatientRef = {
  id: string
  name: string
}

/** Resumen del plan que se le pasa al modelo para responder con cifras reales. */
export type DoctorAssistantFinancialContext = {
  planTotal: number
  collectedAmount: number
  remainingToCollect: number
  invoicedAmount: number
}

export type DoctorAssistantContext = {
  /** Ruta activa (`/odontograma`). */
  route: string
  /** Etiqueta visible de la sección (`Odontograma`). */
  section: string
  activePatient: DoctorAssistantPatientRef | null
  /** Pacientes esperando hoy en sala (llamados o no). */
  waitingCount: number
  nextWaitingPatient: string | null
  financial: DoctorAssistantFinancialContext | null
  /** El rol puede escribir en el odontograma (`admin` o `dentist`). */
  canEditOdontogram: boolean
  /** Fecha local `YYYY-MM-DD` con la que se resuelven «mañana» o «el viernes». */
  today: string
}

export const ASSISTANT_LOCAL_HINT =
  'Comando rápido activo. Configurá VITE_GEMINI_API_KEY para entender frases libres; sin la clave funcionan «llamar al siguiente», «alertas», «estado de cuenta», «modo guía», «preparar cobro» y «preparar factura».'

const MAX_COMMAND_CHARS = 400

const ASSISTANT_SYSTEM_INSTRUCTION = [
  'Sos el copiloto clínico de AD Clinic, una clínica dental de Paraguay.',
  'Recibís un comando dictado por el odontólogo y el contexto actual de la sesión.',
  'Tenés que elegir exactamente UNA herramienta del catálogo y devolver sus parámetros en JSON.',
  '',
  'Catálogo (campo action):',
  '- call_next_patient: llama a sala al siguiente paciente en espera o al paciente nombrado en patient_query.',
  '- open_patient: abre la ficha u odontograma de un paciente (open_target: patients | odontogram).',
  '- read_medical_alerts: lee alergias, medicación y antecedentes del paciente activo o nombrado.',
  '- odontogram_action: agrega un hallazgo o procedimiento a una pieza y cara (status: pending | budgeted | completed | absent).',
  '- read_financial_status: informa planTotal, collectedAmount, remainingToCollect e invoicedAmount del paciente.',
  '- schedule_followup: crea una cita de control con date (YYYY-MM-DD), time (HH:MM de 24 h), duration_minutes (10-240), reason y send_whatsapp.',
  '- prepare_collection_or_invoice: abre Caja para cobrar (disposition: collection) o Facturación para emitir (disposition: invoice).',
  '- guided_workflow: guía paso a paso la consulta (guided_command: start | next | close).',
  '- none: el comando no corresponde a ninguna herramienta.',
  '',
  'Reglas:',
  '1. Respondé en español rioplatense/paraguayo, con voseo, en una o dos frases de menos de 40 palabras.',
  '2. El campo reply se lee en voz alta: sin listas, sin markdown, sin números de factura inventados.',
  '3. Nunca inventes datos clínicos ni financieros: usá solo el contexto recibido.',
  '4. Las acciones que llaman pacientes, agendan o cambian el presupuesto se confirman después en pantalla: escribí el reply sin afirmar que ya se ejecutaron.',
  '5. Si el doctor dice «este paciente» usá activePatient; si nombra a otro, copiá el nombre en patient_query.',
  '6. Si falta el paciente y la acción lo necesita, dejá patient_query vacío: la aplicación pide la ficha.',
  '7. Para odontogram_action usá notación FDI (11-48 permanente, 51-85 temporal) y surface solo si se menciona una cara.',
  '8. Si el comando es ambiguo o no es una acción clínica, usá none y explicá en una frase qué podés hacer.',
].join('\n')

const ASSISTANT_INTENT_SCHEMA: Record<string, unknown> = {
  type: 'OBJECT',
  properties: {
    action: {
      type: 'STRING',
      enum: [
        'none',
        'call_next_patient',
        'open_patient',
        'read_medical_alerts',
        'odontogram_action',
        'read_financial_status',
        'schedule_followup',
        'prepare_collection_or_invoice',
        'guided_workflow',
      ],
    },
    reply: { type: 'STRING' },
    patient_query: { type: 'STRING', nullable: true },
    open_target: { type: 'STRING', enum: ['patients', 'odontogram'], nullable: true },
    odontogram: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        tooth_number: { type: 'INTEGER', minimum: 11, maximum: 85, nullable: true },
        surface: { type: 'STRING', enum: ASSISTANT_SURFACES, nullable: true },
        status: { type: 'STRING', enum: ASSISTANT_STATUSES, nullable: true },
        procedure: { type: 'STRING', nullable: true },
      },
      required: ['procedure'],
    },
    followup: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        date: { type: 'STRING' },
        time: { type: 'STRING' },
        duration_minutes: { type: 'INTEGER', minimum: 10, maximum: 240 },
        reason: { type: 'STRING' },
        send_whatsapp: { type: 'BOOLEAN' },
      },
      required: ['date', 'time'],
    },
    disposition: { type: 'STRING', enum: ['collection', 'invoice'], nullable: true },
    guided_command: { type: 'STRING', enum: ['start', 'next', 'close'], nullable: true },
  },
  required: ['action', 'reply'],
}

/** Interpreta el comando con Gemini y devuelve la intención normalizada. */
export async function parseDoctorCommand(
  command: string,
  context: DoctorAssistantContext,
): Promise<AssistantIntent> {
  if (!isGeminiConfigured()) throw new GeminiError(GEMINI_MISSING_KEY_MESSAGE)

  const text = command.replace(/\s+/g, ' ').trim().slice(0, MAX_COMMAND_CHARS)

  if (!text) throw new Error('No se escuchó ningún comando. Volvé a intentar.')

  const raw = await requestGeminiJson({
    systemInstruction: ASSISTANT_SYSTEM_INSTRUCTION,
    prompt: [
      'Contexto actual de la clínica (JSON):',
      JSON.stringify(context),
      '',
      `Comando del doctor: "${text}"`,
    ].join('\n'),
    schema: ASSISTANT_INTENT_SCHEMA,
    temperature: 0.1,
    maxOutputTokens: 640,
  })

  const intent = normalizeAssistantIntent(raw)

  if (!intent) {
    throw new Error(
      'No pude interpretar el comando. Probá con «llamar al siguiente», «leer alertas» o «estado de cuenta».',
    )
  }

  return intent
}

// --- Normalización de la respuesta del modelo ---------------------------------

const ACTIONS: AssistantActionType[] = [
  'none',
  'call_next_patient',
  'open_patient',
  'read_medical_alerts',
  'odontogram_action',
  'read_financial_status',
  'schedule_followup',
  'prepare_collection_or_invoice',
  'guided_workflow',
]

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asText(value: unknown, maxLength = 400): string | null {
  if (typeof value !== 'string') return null

  const text = value.replace(/\s+/g, ' ').trim()

  return text ? text.slice(0, maxLength) : null
}

function asAction(value: unknown): AssistantActionType | null {
  if (typeof value !== 'string') return null

  return ACTIONS.includes(value as AssistantActionType) ? (value as AssistantActionType) : null
}

function asOpenTarget(value: unknown): AssistantOpenTarget | null {
  return value === 'patients' || value === 'odontogram' ? value : null
}

function asDisposition(value: unknown): AssistantDisposition | null {
  return value === 'collection' || value === 'invoice' ? value : null
}

function asGuidedCommand(value: unknown): AssistantGuidedCommand | null {
  return value === 'start' || value === 'next' || value === 'close' ? value : null
}

/** Pieza FDI válida: 11-48 (permanente) o 51-85 (temporal). */
function asToothNumber(value: unknown): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN

  if (!Number.isInteger(parsed) || parsed < 11 || parsed > 85) return null

  const quadrant = Math.floor(parsed / 10)
  const position = parsed % 10

  if (position < 1 || position > 8) return null
  if (quadrant < 1 || quadrant > 8) return null

  return parsed
}

function asSurface(value: unknown): ToothSurface | null {
  return typeof value === 'string' && ASSISTANT_SURFACES.includes(value as ToothSurface)
    ? (value as ToothSurface)
    : null
}

function asStatus(value: unknown): OdontogramItemStatus {
  return typeof value === 'string' && ASSISTANT_STATUSES.includes(value as OdontogramItemStatus)
    ? (value as OdontogramItemStatus)
    : 'budgeted'
}

function asDateKey(value: unknown): string | null {
  const text = asText(value, 10)
  const match = text ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text) : null

  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }

  return text
}

function asTime(value: unknown): string | null {
  const text = asText(value, 5)
  const match = text ? /^(\d{1,2}):(\d{2})$/.exec(text) : null

  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])

  if (hours > 23 || minutes > 59) return null

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function asFollowup(value: unknown): AssistantFollowupDraft | null {
  const record = asRecord(value)

  if (!record) return null

  const date = asDateKey(record.date)
  const time = asTime(record.time)

  if (!date || !time) return null

  const rawDuration =
    typeof record.duration_minutes === 'number' ? Math.round(record.duration_minutes) : 30
  const duration = Number.isFinite(rawDuration) ? rawDuration : 30

  return {
    date,
    time,
    durationMinutes: Math.min(240, Math.max(10, duration)),
    reason: asText(record.reason, 120) ?? 'Control',
    sendWhatsApp: record.send_whatsapp === true,
  }
}

function asOdontogram(value: unknown): AssistantOdontogramDraft | null {
  const record = asRecord(value)

  if (!record) return null

  const toothNumber = asToothNumber(record.tooth_number)

  if (!toothNumber) return null

  const status = asStatus(record.status)

  return {
    toothNumber,
    surface: status === 'absent' ? null : asSurface(record.surface),
    status,
    procedure: asText(record.procedure, 160) ?? '',
  }
}

/** Texto de respaldo cuando el modelo elige una acción pero no redacta el reply. */
export function defaultAssistantReply(action: AssistantActionType): string {
  switch (action) {
    case 'call_next_patient':
      return 'Voy a llamar al paciente a la sala de espera.'
    case 'open_patient':
      return 'Abro la ficha del paciente.'
    case 'read_medical_alerts':
      return 'Reviso las alertas médicas del paciente.'
    case 'odontogram_action':
      return 'Preparo el hallazgo para guardarlo en el plan.'
    case 'read_financial_status':
      return 'Consulto el estado del plan.'
    case 'schedule_followup':
      return 'Preparo la cita de control.'
    case 'prepare_collection_or_invoice':
      return 'Abro el circuito de cobro.'
    case 'guided_workflow':
      return 'Arrancamos la guía de consulta.'
    default:
      return 'Decime si querés llamar al siguiente paciente, leer alertas o consultar el estado de cuenta.'
  }
}

/**
 * Convierte la respuesta cruda del modelo en una intención confiable.
 * Devuelve `null` si la acción no existe o si falta un dato imprescindible.
 */
export function normalizeAssistantIntent(raw: unknown): AssistantIntent | null {
  const record = asRecord(raw)

  if (!record) return null

  const action = asAction(record.action)

  if (!action) return null

  const intent: AssistantIntent = {
    action,
    reply: asText(record.reply, 400) ?? defaultAssistantReply(action),
    patientQuery: asText(record.patient_query, 120),
    openTarget: action === 'open_patient' ? (asOpenTarget(record.open_target) ?? 'patients') : null,
    odontogram: action === 'odontogram_action' ? asOdontogram(record.odontogram) : null,
    followup: action === 'schedule_followup' ? asFollowup(record.followup) : null,
    disposition:
      action === 'prepare_collection_or_invoice'
        ? (asDisposition(record.disposition) ?? 'collection')
        : null,
    guidedCommand:
      action === 'guided_workflow' ? (asGuidedCommand(record.guided_command) ?? 'start') : null,
  }

  if (action === 'odontogram_action' && !intent.odontogram) return null
  if (action === 'schedule_followup' && !intent.followup) return null

  return intent
}

// --- Comandos rápidos sin Gemini ----------------------------------------------

const WEEKDAY_INDEX: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
}

const GUIDED_START = /\b(modo guia|guiame|guia de consulta|iniciar guia|arrancar la guia)\b/
const GUIDED_NEXT = /\b(siguiente paso|paso siguiente|avanzar|continuar la guia)\b/
const GUIDED_CLOSE = /\b(cerrar consulta|cerrar la consulta|terminar consulta|finalizar consulta)\b/
const INVOICE = /\b(factura|facturar|facturacion|comprobante|timbrado)\b/
const COLLECTION = /\b(caja|cobrar|cobro|pago|pagar)\b/
const ALERTS = /\b(alerta|alertas|alergia|alergias|antecedente|antecedentes|medicacion)\b/
const FINANCIAL = /\b(estado de cuenta|saldo|deuda|cobrado|presupuesto|plan)\b/
const CALL = /\b(llamar|llama|llamando|pasar|pasa)\b/
const FOLLOWUP = /\b(agendar|agenda|reagendar|control|turno|proxima|cita)\b/
const ODONTOGRAM_OPEN = /\b(abrir|abri|abre|mostrar|mostra|odontograma)\b/
const PATIENT_OPEN = /\b(abrir|abri|abre|buscar|busca|ficha)\b/
const HELP = /\b(ayuda|que podes hacer|comandos|opciones|como funciona)\b/

/** Minúsculas, sin tildes ni signos: los patrones se escriben en ASCII. */
function normalizeCommand(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9:\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** `Date` local → `YYYY-MM-DD` (sin pasar por UTC para no correr el día). */
export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** `YYYY-MM-DD` → `Date` local a medianoche; `null` si no es una fecha real. */
export function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())

  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }

  return date
}

export function addDaysToDateKey(value: string, days: number): string {
  const base = parseDateKey(value)

  if (!base) return value

  base.setDate(base.getDate() + days)

  return toDateKey(base)
}

/** Resuelve «mañana», «pasado mañana», «en 15 días» o «el viernes» sobre la fecha de hoy. */
export function resolveLocalDate(command: string, today: string): string | null {
  const normalized = normalizeCommand(command)
  const base = parseDateKey(today)
  const inDays = /\ben (\d{1,2}) dias?\b/.exec(normalized)

  if (inDays) return addDaysToDateKey(today, Number(inDays[1]))
  if (/\bpasado manana\b/.test(normalized)) return addDaysToDateKey(today, 2)
  if (/\bmanana\b/.test(normalized)) return addDaysToDateKey(today, 1)
  if (/\bhoy\b/.test(normalized)) return today

  if (!base) return null

  for (const [name, index] of Object.entries(WEEKDAY_INDEX)) {
    if (!new RegExp(`\\b${name}\\b`).test(normalized)) continue

    // Siempre la próxima aparición del día: «el viernes» un viernes es dentro de 7 días.
    const delta = (index - base.getDay() + 7) % 7 || 7

    return addDaysToDateKey(today, delta)
  }

  return null
}

/**
 * Hora dicha en voz alta: `a las 15`, `a las 10:30`, `a las 3 y media`.
 * En la clínica «a las 3» es 15:00, así que las horas de 1 a 7 pasan a la tarde.
 */
export function resolveLocalTime(command: string): string | null {
  const normalized = normalizeCommand(command)
  const explicit = /\b(\d{1,2})[:.](\d{2})\b/.exec(normalized)

  if (explicit) {
    const hours = Number(explicit[1])
    const minutes = Number(explicit[2])

    if (hours <= 23 && minutes <= 59) return `${pad2(hours)}:${pad2(minutes)}`
  }

  const spoken = /\ba las?\s+(\d{1,2})(?:\s+(y media|y cuarto|menos cuarto))?/.exec(normalized)

  if (!spoken) return null

  let hours = Number(spoken[1])
  let minutes = 0

  if (spoken[2] === 'y media') minutes = 30
  else if (spoken[2] === 'y cuarto') minutes = 15
  else if (spoken[2] === 'menos cuarto') {
    minutes = 45
    hours -= 1
  }

  if (!Number.isFinite(hours) || hours < 0 || hours > 23) return null
  if (hours >= 1 && hours <= 7) hours += 12

  return `${pad2(hours)}:${pad2(minutes)}`
}

function localIntent(
  action: AssistantIntent['action'],
  reply: string,
  extra: Partial<AssistantIntent> = {},
): AssistantIntent {
  return {
    action,
    reply,
    patientQuery: null,
    openTarget: null,
    odontogram: null,
    followup: null,
    disposition: null,
    guidedCommand: null,
    ...extra,
  }
}

/** Quita las palabras de relleno para quedarse con el nombre dictado. */
function extractPatientQuery(normalized: string): string | null {
  const cleaned = normalized
    .replace(
      /\b(abrir|abri|abre|buscar|busca|ficha|de|del|el|la|los|las|al|paciente|odontograma|mostrar|mostra|por|favor)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned.length >= 3 ? cleaned : null
}

/**
 * Comandos que no necesitan modelo: los resuelve el propio navegador.
 *
 * Devuelve `null` cuando la frase no coincide con ningún patrón conocido, para
 * que el contexto intente con Gemini (si hay clave) o avise que no entendió.
 */
export function parseDoctorCommandLocally(
  command: string,
  context: DoctorAssistantContext,
): AssistantIntent | null {
  const normalized = normalizeCommand(command)

  if (!normalized) return null

  if (HELP.test(normalized)) {
    return localIntent(
      'none',
      'Puedo llamar al siguiente paciente, abrir una ficha, leer alertas médicas, dictar un hallazgo, agendar un control, cobrar el plan o emitir la factura. Decime cómo te ayudo.',
    )
  }

  if (GUIDED_CLOSE.test(normalized)) {
    return localIntent('guided_workflow', 'Cierro la guía y paso al cobro del plan.', {
      guidedCommand: 'close',
    })
  }

  if (GUIDED_START.test(normalized)) {
    return localIntent('guided_workflow', 'Arrancamos la guía de consulta.', {
      guidedCommand: 'start',
    })
  }

  if (GUIDED_NEXT.test(normalized)) {
    return localIntent('guided_workflow', 'Paso al siguiente punto de la guía.', {
      guidedCommand: 'next',
    })
  }

  if (INVOICE.test(normalized)) {
    return localIntent('prepare_collection_or_invoice', 'Abro facturación con el paciente activo.', {
      disposition: 'invoice',
    })
  }

  if (COLLECTION.test(normalized)) {
    return localIntent('prepare_collection_or_invoice', 'Abro caja con el paciente activo.', {
      disposition: 'collection',
    })
  }

  if (ALERTS.test(normalized)) {
    return localIntent(
      'read_medical_alerts',
      context.activePatient
        ? `Leo las alertas de ${context.activePatient.name}.`
        : 'Necesito un paciente activo para leer las alertas: abrí una ficha o decime el nombre.',
    )
  }

  if (CALL.test(normalized)) {
    if (context.waitingCount === 0) {
      return localIntent('none', 'No hay pacientes esperando en la sala en este momento.')
    }

    return localIntent(
      'call_next_patient',
      context.nextWaitingPatient
        ? `Llamo a ${context.nextWaitingPatient} a la sala.`
        : 'Llamo al siguiente paciente a la sala.',
    )
  }

  if (ODONTOGRAM_OPEN.test(normalized) || PATIENT_OPEN.test(normalized)) {
    const target = /\bodontograma\b/.test(normalized) ? 'odontogram' : 'patients'

    return localIntent(
      'open_patient',
      target === 'odontogram' ? 'Abro el odontograma del paciente.' : 'Abro la ficha del paciente.',
      { openTarget: target, patientQuery: extractPatientQuery(normalized) },
    )
  }

  if (FOLLOWUP.test(normalized)) {
    const date = resolveLocalDate(normalized, context.today)
    const time = resolveLocalTime(normalized)

    if (date && time) {
      return localIntent('schedule_followup', 'Preparo la cita de control para confirmarla.', {
        followup: {
          date,
          time,
          durationMinutes: 30,
          reason: 'Control',
          sendWhatsApp: /\bwhatsapp\b/.test(normalized),
        },
      })
    }

    return localIntent(
      'none',
      'Decime día y hora del control, por ejemplo «agendá control el viernes a las 10».',
    )
  }

  if (FINANCIAL.test(normalized)) {
    return localIntent(
      'read_financial_status',
      context.activePatient
        ? `Reviso el estado de cuenta de ${context.activePatient.name}.`
        : 'Necesito un paciente activo para revisar el estado de cuenta.',
    )
  }

  return null
}
