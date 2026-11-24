import { createContext, useContext } from 'react'
import type { Patient } from '../patients/patient-types'
import type {
  AssistantConfirmation,
  AssistantReply,
  GuidedStepDefinition,
  GuidedStepId,
} from './assistant-types'

/**
 * Estado global del copiloto clínico.
 *
 * Se monta dentro de `AppLayout`, así que vive mientras el usuario está
 * autenticado y cualquier pantalla puede fijar el paciente activo o leer lo que
 * el asistente escuchó. El dock flotante es la única interfaz del estado; las
 * páginas solo sincronizan el paciente y refrescan datos cuando el copiloto
 * escribe en la base.
 */

export type DoctorAssistantValue = {
  /** Paciente en consulta: se fija al abrir ficha/odontograma o al pedirlo por voz. */
  activePatient: Patient | null
  setActivePatient: (patient: Patient | null) => void
  isListening: boolean
  isSpeaking: boolean
  isProcessing: boolean
  /** El panel está abierto (el botón flotante lo abre desde cualquier pantalla). */
  isDockOpen: boolean
  /** Último comando reconocido (texto final, sin el «Asistente»). */
  transcript: string
  /** Texto provisorio mientras el doctor habla. */
  interimTranscript: string
  assistantReply: AssistantReply | null
  pendingConfirmation: AssistantConfirmation | null
  guidedStep: GuidedStepDefinition | null
  guidedStepNumber: number
  guidedCompleted: GuidedStepId[]
  totalGuidedSteps: number
  /** Interruptor de respuestas habladas (se recuerda en `localStorage`). */
  voiceFeedbackEnabled: boolean
  isSpeechSupported: boolean
  isAiConfigured: boolean
  openDock: () => void
  closeDock: () => void
  toggleDock: () => void
  startListening: () => void
  stopListening: () => void
  toggleListening: () => void
  /** Ejecuta un comando escrito o dictado (lo usa el campo del dock). */
  submitCommand: (text: string) => void
  confirmPendingAction: () => void
  cancelPendingAction: () => void
  setVoiceFeedbackEnabled: (enabled: boolean) => void
  startGuidedWorkflow: () => void
  advanceGuidedWorkflow: () => void
  /** Sale del modo guía sin cambiar la consulta. */
  closeGuidedWorkflow: () => void
  /** «Cerrar consulta»: salta al cobro del plan y la factura. */
  finishGuidedConsultation: () => void
  /** Ejecuta la acción del paso actual (botón principal de la guía). */
  runGuidedStep: () => void
  repeatReply: () => void
}

export const DoctorAssistantContext = createContext<DoctorAssistantValue | null>(null)

/** Acceso al copiloto. Debe usarse dentro de `<DoctorAssistantProvider>`. */
export function useDoctorAssistant(): DoctorAssistantValue {
  const context = useContext(DoctorAssistantContext)

  if (!context) {
    throw new Error(
      '[AD Clinic] useDoctorAssistant() debe usarse dentro de <DoctorAssistantProvider>.',
    )
  }

  return context
}

/**
 * Subconjunto estable para las pantallas: solo el paciente activo.
 *
 * El valor principal cambia en cada transcripción provisoria del dictado; si
 * una tabla u odontograma lo consumieran, se re-renderizarían decenas de veces
 * por comando. Este contexto cambia solo cuando cambia el paciente.
 */
export type AssistantPatientValue = {
  activePatient: Patient | null
  setActivePatient: (patient: Patient | null) => void
}

export const AssistantPatientContext = createContext<AssistantPatientValue | null>(null)

/** Paciente en consulta + setter. Debe usarse dentro de `<DoctorAssistantProvider>`. */
export function useAssistantPatient(): AssistantPatientValue {
  const context = useContext(AssistantPatientContext)

  if (!context) {
    throw new Error(
      '[AD Clinic] useAssistantPatient() debe usarse dentro de <DoctorAssistantProvider>.',
    )
  }

  return context
}
