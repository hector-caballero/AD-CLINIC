import type { OdontogramItemStatus, ToothSurface } from '../odontogram/odontogram-types'

/**
 * Tipos y catálogo del copiloto clínico por voz.
 *
 * El doctor habla (Web Speech API) y Gemini traduce la frase a **una** de las
 * acciones de `AssistantActionType` (`services/doctor-assistant-ai.ts`). Las
 * acciones que modifican dinero, citas o el presupuesto del odontograma piden
 * confirmación explícita antes de ejecutarse (`actionRequiresConfirmation`):
 * un dictado mal entendido no puede llamar, cobrar ni agendar solo.
 *
 * `none` no está en el catálogo clínico: es la respuesta del modelo cuando el
 * comando no corresponde a ninguna herramienta (saludos, preguntas sueltas).
 */

export type AssistantActionType =
  | 'none'
  | 'call_next_patient'
  | 'open_patient'
  | 'read_medical_alerts'
  | 'odontogram_action'
  | 'read_financial_status'
  | 'schedule_followup'
  | 'prepare_collection_or_invoice'
  | 'guided_workflow'

export type AssistantOpenTarget = 'patients' | 'odontogram'

export type AssistantDisposition = 'collection' | 'invoice'

export type AssistantGuidedCommand = 'start' | 'next' | 'close'

export const ASSISTANT_SURFACES: ToothSurface[] = [
  'occlusal',
  'vestibular',
  'lingual',
  'mesial',
  'distal',
]

export const ASSISTANT_STATUSES: OdontogramItemStatus[] = [
  'pending',
  'budgeted',
  'completed',
  'absent',
]

/** Hallazgo o procedimiento dictado para una pieza y cara. */
export type AssistantOdontogramDraft = {
  /** Pieza FDI: 11-48 en dentición permanente y 51-85 en temporal. */
  toothNumber: number
  /** `null` = pieza completa (lo exige la pieza ausente). */
  surface: ToothSurface | null
  status: OdontogramItemStatus
  /** Nombre dictado; el catálogo de tratamientos se resuelve al ejecutar. */
  procedure: string
}

export type AssistantFollowupDraft = {
  /** `YYYY-MM-DD`. */
  date: string
  /** `HH:MM` en 24 horas. */
  time: string
  /** Entre 10 y 240 minutos (30 por defecto). */
  durationMinutes: number
  reason: string
  /** Dispara el recordatorio de WhatsApp al crear la cita. */
  sendWhatsApp: boolean
}

/** Intención normalizada: lo único que el contexto sabe ejecutar. */
export type AssistantIntent = {
  action: AssistantActionType
  /** Respuesta redactada en español para mostrar y, si corresponde, hablar. */
  reply: string
  /** Nombre o documento dicho por el doctor (búsqueda difusa). */
  patientQuery: string | null
  openTarget: AssistantOpenTarget | null
  odontogram: AssistantOdontogramDraft | null
  followup: AssistantFollowupDraft | null
  disposition: AssistantDisposition | null
  guidedCommand: AssistantGuidedCommand | null
}

export type AssistantReplyTone = 'info' | 'success' | 'warning' | 'error'

/** Enlace que acompaña a una respuesta (por ejemplo, el recordatorio de WhatsApp). */
export type AssistantReplyLink = {
  url: string
  label: string
}

export type AssistantReply = {
  /** Se incrementa en cada respuesta para reiniciar animaciones y `aria-live`. */
  id: number
  tone: AssistantReplyTone
  text: string
  link?: AssistantReplyLink | null
}

/** Acción sensible esperando el «sí» del doctor. */
export type AssistantConfirmation = {
  intent: AssistantIntent
  /** Comando original: se usa para volver a interpretar el odontograma. */
  command: string
  title: string
  detail: string
  confirmLabel: string
}

/** Pasos de la guía «Modo Guía de Consulta». */
export type GuidedStepId =
  | 'call'
  | 'open'
  | 'alerts'
  | 'odontogram'
  | 'finish'
  | 'collect'
  | 'invoice'

/** Acción que ejecuta el botón del paso actual en el dock. */
export type GuidedStepAction =
  | 'call'
  | 'open_odontogram'
  | 'read_alerts'
  | 'dictate'
  | 'open_agenda'
  | 'prepare_collection'
  | 'prepare_invoice'

export type GuidedStepDefinition = {
  id: GuidedStepId
  label: string
  hint: string
  /** Instrucción que se lee en voz alta al entrar al paso. */
  spoken: string
  action: GuidedStepAction
}

/**
 * Recorrido completo de una consulta: desde el llamado en sala hasta la
 * factura. Es el mismo orden que usa la clínica, así la guía no inventa pasos.
 */
export const GUIDED_STEPS: GuidedStepDefinition[] = [
  {
    id: 'call',
    label: 'Llamar al paciente',
    hint: 'El aviso suena en la pantalla de sala (/tv) y deja la cita en sala de espera.',
    spoken: 'Paso uno: llamá al siguiente paciente de la sala de espera.',
    action: 'call',
  },
  {
    id: 'open',
    label: 'Abrir odontograma',
    hint: 'Se abre el odontograma del paciente activo con su presupuesto.',
    spoken: 'Paso dos: abrí el odontograma del paciente para revisar piezas y presupuesto.',
    action: 'open_odontogram',
  },
  {
    id: 'alerts',
    label: 'Revisar alertas médicas',
    hint: 'Alergias, medicación y antecedentes críticos antes de empezar.',
    spoken: 'Paso tres: leé las alertas médicas antes de empezar la atención.',
    action: 'read_alerts',
  },
  {
    id: 'odontogram',
    label: 'Dictar hallazgos',
    hint: 'Decí «pieza 16 oclusal resina» y queda guardado en el presupuesto.',
    spoken: 'Paso cuatro: dictá los hallazgos por pieza y cara.',
    action: 'dictate',
  },
  {
    id: 'finish',
    label: 'Marcar la atención',
    hint: 'En la agenda se confirma la cita como atendida antes de cobrar.',
    spoken: 'Paso cinco: marcá la cita como atendida en la agenda.',
    action: 'open_agenda',
  },
  {
    id: 'collect',
    label: 'Cobrar el plan',
    hint: 'Caja abre con el paciente precargado; el cobro se confirma en el modal.',
    spoken: 'Paso seis: cobrá en caja el plan del paciente.',
    action: 'prepare_collection',
  },
  {
    id: 'invoice',
    label: 'Emitir la factura',
    hint: 'Facturación abre con el paciente precargado; el número lo asigna la base.',
    spoken: 'Paso siete: emití la factura del paciente y revisá el formato del emisor.',
    action: 'prepare_invoice',
  },
]

const GUIDED_INDEX = new Map(GUIDED_STEPS.map((step, index) => [step.id, index]))

export function getGuidedStep(id: GuidedStepId | null): GuidedStepDefinition | null {
  if (!id) return null

  return GUIDED_STEPS.find((step) => step.id === id) ?? null
}

/** Número visible del paso (`1` a `GUIDED_STEPS.length`). */
export function getGuidedStepNumber(id: GuidedStepId | null): number {
  if (!id) return 0

  const index = GUIDED_INDEX.get(id)

  return index === undefined ? 0 : index + 1
}

export function getNextGuidedStepId(id: GuidedStepId): GuidedStepId | null {
  const index = GUIDED_INDEX.get(id)

  if (index === undefined) return null

  return GUIDED_STEPS[index + 1]?.id ?? null
}

export function isGuidedStepId(value: unknown): value is GuidedStepId {
  return typeof value === 'string' && GUIDED_STEPS.some((step) => step.id === value)
}

/**
 * Acciones que modifican datos sensibles (llamados, citas, presupuesto/caja).
 * Se muestran como tarjeta de confirmación antes de tocar la base.
 */
export function actionRequiresConfirmation(action: AssistantActionType): boolean {
  return (
    action === 'call_next_patient' ||
    action === 'odontogram_action' ||
    action === 'schedule_followup'
  )
}

/** Texto del botón principal de la tarjeta de confirmación. */
export function confirmationLabel(action: AssistantActionType): string {
  switch (action) {
    case 'call_next_patient':
      return 'Llamar al paciente'
    case 'odontogram_action':
      return 'Guardar en el plan'
    case 'schedule_followup':
      return 'Agendar control'
    default:
      return 'Confirmar'
  }
}
