import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { findNavItem } from '../../components/layout/nav-items'
import {
  ASSISTANT_LOCAL_HINT,
  parseDoctorCommand,
  parseDoctorCommandLocally,
  type DoctorAssistantContext as AssistantAiContext,
  type DoctorAssistantFinancialContext,
} from '../../services/doctor-assistant-ai'
import { isGeminiConfigured } from '../../services/gemini-flash'
import {
  UNSUPPORTED_BROWSER_MESSAGE,
  createSpeechDictation,
  isSpeechDictationSupported,
  type SpeechDictation,
} from '../../services/speech-dictation'
import { useAuth } from '../auth/AuthContext'
import { todayKey } from '../appointments/appointment-dates'
import { getPatientFullName, type Patient } from '../patients/patient-types'
import {
  describeAssistantConfirmation,
  executeAssistantIntent,
  fetchAssistantRoom,
  fetchPatientPlanSummary,
  type AssistantRoomState,
} from './assistant-actions'
import {
  AssistantPatientContext,
  DoctorAssistantContext,
  type AssistantPatientValue,
  type DoctorAssistantValue,
} from './assistant-context'
import { isAssistantSpeechSupported, speakAssistant, stopAssistantSpeech } from './assistant-speech'
import {
  GUIDED_STEPS,
  actionRequiresConfirmation,
  confirmationLabel,
  getGuidedStep,
  getGuidedStepNumber,
  getNextGuidedStepId,
  type AssistantConfirmation,
  type AssistantIntent,
  type AssistantReply,
  type AssistantReplyLink,
  type AssistantReplyTone,
  type GuidedStepDefinition,
  type GuidedStepId,
} from './assistant-types'

/**
 * Proveedor global del copiloto clínico.
 *
 * Vive en `AppLayout`, así que el micrófono, el estado de la guía y el paciente
 * activo sobreviven a la navegación entre módulos. Reglas:
 * - El dictado se crea recién al primer `Alt + V` o al abrir el micrófono: la
 *   Web Speech API pide permiso y no se debe pedir en cada pantalla.
 * - Mientras el asistente habla se corta el micrófono (evita que se escuche a sí
 *   mismo) y, si estaba escuchando, se retoma al terminar la locución.
 * - Nada se ejecuta sin pasar por `executeAssistantIntent`; las acciones
 *   sensibles quedan frenadas en `pendingConfirmation` hasta el «sí» del doctor.
 */

const VOICE_STORAGE_KEY = 'ad-clinic:assistant-voice'

const GENERIC_ERROR = 'No pude completar la acción. Revisá la conexión y volvé a intentar.'

/** Preferencia de voz guardada en el dispositivo (`on` por defecto). */
function readVoicePreference(): boolean {
  if (typeof window === 'undefined') return true

  try {
    return window.localStorage.getItem(VOICE_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : GENERIC_ERROR
}

export function DoctorAssistantProvider({ children }: { children: ReactNode }) {
  const { role, profile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const [activePatient, setActivePatientState] = useState<Patient | null>(null)
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDockOpen, setIsDockOpen] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [assistantReply, setAssistantReply] = useState<AssistantReply | null>(null)
  const [pendingConfirmation, setPendingConfirmation] = useState<AssistantConfirmation | null>(null)
  const [guidedStepId, setGuidedStepId] = useState<GuidedStepId | null>(null)
  const [guidedCompleted, setGuidedCompleted] = useState<GuidedStepId[]>([])
  const [voiceFeedbackEnabled, setVoiceFeedbackState] = useState(readVoicePreference)

  const replyIdRef = useRef(0)
  const dictationRef = useRef<SpeechDictation | null>(null)
  const listeningRef = useRef(false)
  const voiceRef = useRef(voiceFeedbackEnabled)
  const activePatientRef = useRef<Patient | null>(null)
  const guidedRef = useRef<GuidedStepId | null>(null)
  const confirmationRef = useRef<AssistantConfirmation | null>(null)
  const replyRef = useRef<AssistantReply | null>(null)
  const busyRef = useRef(false)
  const canEditRef = useRef(false)
  const dentistIdRef = useRef<string | null>(null)

  const canEditOdontogram = role === 'admin' || role === 'dentist'
  const dentistId = role === 'dentist' ? (profile?.id ?? null) : null

  useEffect(() => {
    activePatientRef.current = activePatient
  }, [activePatient])

  useEffect(() => {
    guidedRef.current = guidedStepId
  }, [guidedStepId])

  useEffect(() => {
    confirmationRef.current = pendingConfirmation
  }, [pendingConfirmation])

  useEffect(() => {
    replyRef.current = assistantReply
  }, [assistantReply])

  useEffect(() => {
    voiceRef.current = voiceFeedbackEnabled
  }, [voiceFeedbackEnabled])

  useEffect(() => {
    canEditRef.current = canEditOdontogram
    dentistIdRef.current = dentistId
  }, [canEditOdontogram, dentistId])

  const setActivePatient = useCallback((patient: Patient | null) => {
    setActivePatientState((current) => {
      if (!current || !patient) return current === patient ? current : patient
      if (current.id !== patient.id) return patient

      // Misma ficha: solo reemplazamos si cambió el nombre (edición de datos).
      return getPatientFullName(current) === getPatientFullName(patient) ? current : patient
    })
  }, [])

  /**
   * Lee una respuesta. Si el micrófono estaba activo se corta durante la
   * locución (para no transcribir la propia voz) y se retoma al terminar.
   * `force` saltea la preferencia de voz: «repetir» siempre se escucha.
   */
  const speak = useCallback((text: string, force = false) => {
    if ((!force && !voiceRef.current) || !text.trim() || !isAssistantSpeechSupported()) return

    const shouldResume = listeningRef.current

    if (shouldResume) {
      listeningRef.current = false
      dictationRef.current?.stop()
      setIsListening(false)
    }

    const started = speakAssistant(text, {
      onStart: () => setIsSpeaking(true),
      onEnd: () => {
        setIsSpeaking(false)

        if (shouldResume && dictationRef.current) {
          listeningRef.current = true
          dictationRef.current.start()
        }
      },
    })

    if (!started) setIsSpeaking(false)
  }, [])

  const pushReply = useCallback(
    (
      tone: AssistantReplyTone,
      text: string,
      link: AssistantReplyLink | null = null,
      spoken = text,
    ) => {
      replyIdRef.current += 1

      const reply: AssistantReply = { id: replyIdRef.current, tone, text, link }

      replyRef.current = reply
      setAssistantReply(reply)
      speak(spoken)
    },
    [speak],
  )

  const startGuidedWorkflow = useCallback(() => {
    const first = GUIDED_STEPS[0]

    guidedRef.current = first.id
    setGuidedStepId(first.id)
    setGuidedCompleted([])
    setPendingConfirmation(null)
    setIsDockOpen(true)

    pushReply(
      'info',
      `Modo guía: paso 1 de ${GUIDED_STEPS.length} — ${first.label}. ${first.hint}`,
      null,
      first.spoken,
    )
  }, [pushReply])

  const advanceGuidedWorkflow = useCallback(() => {
    const current = guidedRef.current

    if (!current) {
      startGuidedWorkflow()

      return
    }

    const next = getNextGuidedStepId(current)

    setGuidedCompleted((list) => (list.includes(current) ? list : [...list, current]))

    if (!next) {
      guidedRef.current = null
      setGuidedStepId(null)
      pushReply(
        'success',
        'Terminaste el recorrido de la consulta. Si falta cobrar, decime «preparar cobro».',
        null,
        'Terminaste el recorrido de la consulta. Decime preparar cobro para abrir caja.',
      )

      return
    }

    guidedRef.current = next
    setGuidedStepId(next)

    const step = getGuidedStep(next)

    if (!step) return

    pushReply(
      'info',
      `Paso ${getGuidedStepNumber(next)} de ${GUIDED_STEPS.length}: ${step.label}. ${step.hint}`,
      null,
      step.spoken,
    )
  }, [pushReply, startGuidedWorkflow])

  const closeGuidedWorkflow = useCallback(() => {
    if (!guidedRef.current) {
      pushReply('info', 'La guía ya estaba cerrada.', null, 'La guía ya estaba cerrada.')

      return
    }

    guidedRef.current = null
    setGuidedStepId(null)
    setGuidedCompleted([])
    pushReply('info', 'Cerré la guía. Seguimos con la consulta normal.', null, 'Listo, cerré la guía.')
  }, [pushReply])

  const finishGuidedConsultation = useCallback(() => {
    const step = getGuidedStep('collect')

    guidedRef.current = 'collect'
    setGuidedStepId('collect')

    if (!step) return

    pushReply('info', `Cerramos la atención con el cobro: ${step.hint}`, null, step.spoken)
  }, [pushReply])

  const handleGuidedCommand = useCallback(
    (intent: AssistantIntent) => {
      switch (intent.guidedCommand) {
        case 'close':
          closeGuidedWorkflow()
          return
        case 'next':
          advanceGuidedWorkflow()
          return
        default:
          startGuidedWorkflow()
      }
    },
    [advanceGuidedWorkflow, closeGuidedWorkflow, startGuidedWorkflow],
  )

  /** Marca el paso cumplido y devuelve el siguiente (lo usa `runIntent`). */
  const completeGuidedStep = useCallback((step: GuidedStepId): GuidedStepDefinition | null => {
    if (!guidedRef.current) return null

    setGuidedCompleted((list) => (list.includes(step) ? list : [...list, step]))

    const next = getNextGuidedStepId(step)

    guidedRef.current = next
    setGuidedStepId(next)

    return getGuidedStep(next)
  }, [])

  /** Ejecuta una intención ya validada y aplica el resultado a la interfaz. */
  const runIntent = useCallback(
    async (intent: AssistantIntent, today: string, room: AssistantRoomState | null) => {
      try {
        const result = await executeAssistantIntent(intent, {
          activePatient: activePatientRef.current,
          today,
          canEditOdontogram: canEditRef.current,
          dentistId: dentistIdRef.current,
          room,
        })

        if (result.patient) {
          activePatientRef.current = result.patient
          setActivePatientState(result.patient)
        }

        const nextStep = result.guidedStep ? completeGuidedStep(result.guidedStep) : null
        const spoken = nextStep ? `${result.text} ${nextStep.spoken}` : result.text

        pushReply(result.tone, result.text, result.link, spoken)

        if (result.navigateTo) navigate(result.navigateTo)
      } catch (error) {
        pushReply('error', errorMessage(error))
      }
    },
    [completeGuidedStep, navigate, pushReply],
  )

  const submitCommand = useCallback(
    async (raw: string) => {
      const command = raw.replace(/\s+/g, ' ').trim()

      if (!command || busyRef.current) return

      busyRef.current = true
      setIsProcessing(true)
      setTranscript(command)
      setInterimTranscript('')
      setPendingConfirmation(null)
      confirmationRef.current = null

      try {
        const patient = activePatientRef.current
        const today = todayKey()
        let room: AssistantRoomState | null = null
        let financial: DoctorAssistantFinancialContext | null = null

        try {
          room = await fetchAssistantRoom(today)

          if (patient) {
            const summary = await fetchPatientPlanSummary(patient.id)

            financial = {
              planTotal: summary.planTotal,
              collectedAmount: summary.collectedAmount,
              remainingToCollect: summary.remainingToCollect,
              invoicedAmount: summary.invoicedAmount,
            }
          }
        } catch {
          // Sin datos de la sala el comando igual se puede ejecutar (la acción
          // vuelve a consultar si necesita la agenda del día).
          room = null
        }

        const section = findNavItem(location.pathname)
        const aiContext: AssistantAiContext = {
          route: location.pathname,
          section: section?.label ?? 'AD Clinic',
          activePatient: patient ? { id: patient.id, name: getPatientFullName(patient) } : null,
          waitingCount: room?.snapshot.waiting.length ?? 0,
          nextWaitingPatient: room?.snapshot.waiting[0]?.patientName ?? null,
          financial,
          canEditOdontogram: canEditRef.current,
          today,
        }

        let intent: AssistantIntent | null = null

        if (isGeminiConfigured()) {
          try {
            intent = await parseDoctorCommand(command, aiContext)
          } catch {
            // Gemini caído o sin cuota: el parser rápido sigue funcionando.
            intent = null
          }
        }

        if (!intent) intent = parseDoctorCommandLocally(command, aiContext)

        if (!intent) {
          pushReply(
            'warning',
            `No entendí «${command}». ${ASSISTANT_LOCAL_HINT}`,
            null,
            'No entendí el comando. Probá con llamar al siguiente, leer alertas o estado de cuenta.',
          )

          return
        }

        if (intent.action === 'guided_workflow') {
          handleGuidedCommand(intent)

          return
        }

        if (actionRequiresConfirmation(intent.action)) {
          const confirmation: AssistantConfirmation = {
            intent,
            command,
            ...describeAssistantConfirmation(intent, patient),
            confirmLabel: confirmationLabel(intent.action),
          }

          confirmationRef.current = confirmation
          setPendingConfirmation(confirmation)
          pushReply('info', intent.reply)

          return
        }

        await runIntent(intent, today, room)
      } finally {
        busyRef.current = false
        setIsProcessing(false)
      }
    },
    [handleGuidedCommand, location.pathname, pushReply, runIntent],
  )

  const confirmPendingAction = useCallback(async () => {
    const pending = confirmationRef.current

    if (!pending) return

    confirmationRef.current = null
    setPendingConfirmation(null)
    setIsProcessing(true)

    try {
      const today = todayKey()
      const room = await fetchAssistantRoom(today).catch(() => null)

      await runIntent(pending.intent, today, room)
    } finally {
      setIsProcessing(false)
    }
  }, [runIntent])

  const cancelPendingAction = useCallback(() => {
    confirmationRef.current = null
    setPendingConfirmation(null)
    pushReply('info', 'Cancelé la acción. No se modificó nada.', null, 'Listo, cancelé la acción.')
  }, [pushReply])

  const ensureDictation = useCallback(() => {
    if (dictationRef.current) return dictationRef.current

    const dictation = createSpeechDictation({
      onTranscript: (_final, interim) => setInterimTranscript(interim),
      onPhrase: (phrase) => {
        setInterimTranscript('')
        void submitCommand(phrase)
      },
      onError: (message) => {
        // Un error del micrófono no debe reabrir la escucha al terminar de hablar.
        listeningRef.current = false
        setIsListening(false)
        pushReply('error', message)
      },
      onStateChange: (state) => setIsListening(state === 'listening'),
    })

    dictationRef.current = dictation

    return dictation
  }, [pushReply, submitCommand])

  const startListening = useCallback(() => {
    if (!isSpeechDictationSupported()) {
      pushReply('error', UNSUPPORTED_BROWSER_MESSAGE)

      return
    }

    stopAssistantSpeech()
    setIsSpeaking(false)
    setIsDockOpen(true)

    try {
      const dictation = ensureDictation()

      listeningRef.current = true
      dictation.start()
      setIsListening(true)
    } catch (error) {
      listeningRef.current = false
      setIsListening(false)
      pushReply('error', errorMessage(error))
    }
  }, [ensureDictation, pushReply])

  const stopListening = useCallback(() => {
    listeningRef.current = false
    dictationRef.current?.stop()
    setIsListening(false)
    setInterimTranscript('')
  }, [])

  const toggleListening = useCallback(() => {
    if (listeningRef.current) stopListening()
    else startListening()
  }, [startListening, stopListening])

  const openDock = useCallback(() => setIsDockOpen(true), [])

  const closeDock = useCallback(() => {
    setIsDockOpen(false)
    listeningRef.current = false
    dictationRef.current?.stop()
    setIsListening(false)
    setInterimTranscript('')
  }, [])

  const toggleDock = useCallback(() => {
    setIsDockOpen((open) => !open)
  }, [])

  const setVoiceFeedbackEnabled = useCallback((enabled: boolean) => {
    voiceRef.current = enabled
    setVoiceFeedbackState(enabled)

    if (!enabled) {
      stopAssistantSpeech()
      setIsSpeaking(false)
    }

    try {
      window.localStorage.setItem(VOICE_STORAGE_KEY, enabled ? 'on' : 'off')
    } catch {
      // Modo privado sin `localStorage`: la preferencia dura la sesión.
    }
  }, [])

  const repeatReply = useCallback(() => {
    const reply = replyRef.current

    if (!reply) {
      pushReply('info', 'Todavía no hay ninguna respuesta para repetir.', null, '')

      return
    }

    speak(reply.text, true)
  }, [pushReply, speak])

  const runGuidedStep = useCallback(() => {
    const step = getGuidedStep(guidedRef.current)

    if (!step) {
      startGuidedWorkflow()

      return
    }

    switch (step.action) {
      case 'call':
        void submitCommand('llamar al siguiente paciente')
        return
      case 'read_alerts':
        void submitCommand('leer las alertas del paciente')
        return
      case 'open_odontogram': {
        const patient = activePatientRef.current

        navigate(patient ? `/odontograma?paciente=${encodeURIComponent(patient.id)}` : '/odontograma')
        advanceGuidedWorkflow()
        return
      }
      case 'dictate':
        pushReply(
          'info',
          'Dictá la pieza y el procedimiento. Por ejemplo: «pieza 16 oclusal resina presupuestado».',
          null,
          'Dictá la pieza y el procedimiento. Por ejemplo: pieza dieciséis oclusal resina presupuestado.',
        )
        return
      case 'open_agenda':
        navigate('/citas')
        advanceGuidedWorkflow()
        return
      case 'prepare_collection':
        void submitCommand('preparar cobro')
        return
      case 'prepare_invoice':
        void submitCommand('preparar factura')
        return
      default:
        advanceGuidedWorkflow()
    }
  }, [advanceGuidedWorkflow, navigate, pushReply, startGuidedWorkflow, submitCommand])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key.toLowerCase() !== 'v') return

      event.preventDefault()
      setIsDockOpen(true)

      if (listeningRef.current) stopListening()
      else startListening()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [startListening, stopListening])

  useEffect(() => {
    return () => {
      listeningRef.current = false
      dictationRef.current?.dispose()
      dictationRef.current = null
      stopAssistantSpeech()
    }
  }, [])

  const guidedStep = useMemo(() => getGuidedStep(guidedStepId), [guidedStepId])

  const patientValue = useMemo<AssistantPatientValue>(
    () => ({ activePatient, setActivePatient }),
    [activePatient, setActivePatient],
  )

  const value = useMemo<DoctorAssistantValue>(
    () => ({
      activePatient,
      setActivePatient,
      isListening,
      isSpeaking,
      isProcessing,
      isDockOpen,
      transcript,
      interimTranscript,
      assistantReply,
      pendingConfirmation,
      guidedStep,
      guidedStepNumber: getGuidedStepNumber(guidedStepId),
      guidedCompleted,
      totalGuidedSteps: GUIDED_STEPS.length,
      voiceFeedbackEnabled,
      isSpeechSupported: isSpeechDictationSupported(),
      isAiConfigured: isGeminiConfigured(),
      openDock,
      closeDock,
      toggleDock,
      startListening,
      stopListening,
      toggleListening,
      submitCommand: (text: string) => {
        void submitCommand(text)
      },
      confirmPendingAction: () => {
        void confirmPendingAction()
      },
      cancelPendingAction,
      setVoiceFeedbackEnabled,
      startGuidedWorkflow,
      advanceGuidedWorkflow,
      closeGuidedWorkflow,
      finishGuidedConsultation,
      runGuidedStep,
      repeatReply,
    }),
    [
      activePatient,
      advanceGuidedWorkflow,
      assistantReply,
      cancelPendingAction,
      closeDock,
      closeGuidedWorkflow,
      confirmPendingAction,
      finishGuidedConsultation,
      guidedCompleted,
      guidedStep,
      guidedStepId,
      interimTranscript,
      isDockOpen,
      isListening,
      isProcessing,
      isSpeaking,
      openDock,
      pendingConfirmation,
      repeatReply,
      runGuidedStep,
      setActivePatient,
      setVoiceFeedbackEnabled,
      startGuidedWorkflow,
      startListening,
      stopListening,
      submitCommand,
      toggleDock,
      toggleListening,
      transcript,
      voiceFeedbackEnabled,
    ],
  )

  return (
    <DoctorAssistantContext.Provider value={value}>
      <AssistantPatientContext.Provider value={patientValue}>
        {children}
      </AssistantPatientContext.Provider>
    </DoctorAssistantContext.Provider>
  )
}

