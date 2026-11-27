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
import {
  ASSISTANT_SPEECH_RESUME_DELAY_MS,
  isAssistantSpeaking,
  isAssistantSpeechSupported,
  speakAssistant,
  stopAssistantSpeech,
} from './assistant-speech'
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
 * - Half-duplex anti-eco: antes de hablar se corta el micrófono y se retoma
 *   `ASSISTANT_SPEECH_RESUME_DELAY_MS` (350 ms) después de `onend`. Con el
 *   «modo tablet continuo» la escucha vuelve sola; sin él, solo si ya estaba
 *   escuchando cuando el copiloto empezó a hablar.
 * - El dictado acumula los tramos confirmados y envía el comando recién tras
 *   `SILENCE_WINDOW_MS` (2 s) de silencio, o cuando el doctor termina con
 *   «listo» / «ejecutar». `silenceProgress` alimenta la barra del dock.
 * - Nada se ejecuta sin pasar por `executeAssistantIntent`; las acciones
 *   sensibles quedan frenadas en `pendingConfirmation` hasta el «sí» del doctor.
 */

const VOICE_STORAGE_KEY = 'ad-clinic:assistant-voice'

/** «Modo tablet continuo»: el micrófono vuelve solo después de cada respuesta. */
const CONTINUOUS_STORAGE_KEY = 'ad-clinic:assistant-continuous'

/**
 * Ventana de silencio del acumulador: el doctor puede pensar a mitad de la
 * frase sin que el comando se envíe cortado.
 */
const SILENCE_WINDOW_MS = 2000

/**
 * Palabra final que fuerza el envío sin esperar los dos segundos:
 * «…y listo», «…ejecutar».
 */
const FLUSH_KEYWORD =
  /\b(listo|ejecutar|ejecuta|ejecutá|dale|termina|terminá|terminado)\b[\s.!?]*$/i

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

/**
 * Tablets del consultorio: por defecto el copiloto vuelve a escuchar después de
 * cada respuesta. Solo se desactiva si el doctor lo apaga (se recuerda).
 */
function readContinuousPreference(): boolean {
  if (typeof window === 'undefined') return true

  try {
    return window.localStorage.getItem(CONTINUOUS_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

/** Quita «listo» / «ejecutar» del comando antes de interpretarlo. */
function stripFlushKeyword(text: string): string {
  return text.replace(FLUSH_KEYWORD, '').replace(/\s+/g, ' ').trim()
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
  const [continuousMode, setContinuousModeState] = useState(readContinuousPreference)
  const [silenceProgress, setSilenceProgress] = useState(0)

  const replyIdRef = useRef(0)
  const dictationRef = useRef<SpeechDictation | null>(null)
  const listeningRef = useRef(false)
  const voiceRef = useRef(voiceFeedbackEnabled)
  const continuousRef = useRef(continuousMode)
  const dockOpenRef = useRef(isDockOpen)
  const activePatientRef = useRef<Patient | null>(null)
  const guidedRef = useRef<GuidedStepId | null>(null)
  const confirmationRef = useRef<AssistantConfirmation | null>(null)
  const replyRef = useRef<AssistantReply | null>(null)
  const busyRef = useRef(false)
  const canEditRef = useRef(false)
  const dentistIdRef = useRef<string | null>(null)
  /** Reactivación del micrófono programada después de `onend`. */
  const resumeTimerRef = useRef<number | null>(null)
  /** Inicio de la ventana de silencio del comando en curso. */
  const silenceStartRef = useRef(0)
  const silenceTickerRef = useRef<number | null>(null)
  /** El dictado se crea una vez: guarda el submit vigente para no quedar viejo. */
  const submitCommandRef = useRef<(text: string) => void>(() => {})
  const beginDictationRef = useRef<() => boolean>(() => false)

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
    continuousRef.current = continuousMode
  }, [continuousMode])

  useEffect(() => {
    dockOpenRef.current = isDockOpen
  }, [isDockOpen])

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

  const clearResumeTimer = useCallback(() => {
    if (resumeTimerRef.current === null) return

    window.clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = null
  }, [])

  const stopSilenceTicker = useCallback(() => {
    if (silenceTickerRef.current !== null) {
      window.clearInterval(silenceTickerRef.current)
      silenceTickerRef.current = null
    }

    silenceStartRef.current = 0
    setSilenceProgress(0)
  }, [])

  /** Reinicia la barra de 2 s en cada palabra detectada por el dictado. */
  const noteVoiceActivity = useCallback(() => {
    silenceStartRef.current = Date.now()

    if (silenceTickerRef.current !== null) return

    silenceTickerRef.current = window.setInterval(() => {
      const startedAt = silenceStartRef.current

      if (!startedAt || !listeningRef.current) return

      const progress = Math.min(1, (Date.now() - startedAt) / SILENCE_WINDOW_MS)

      setSilenceProgress(progress)

      // La barra llegó al final: el dictado está por entregar la frase.
      if (progress >= 1 && silenceTickerRef.current !== null) {
        window.clearInterval(silenceTickerRef.current)
        silenceTickerRef.current = null
      }
    }, 100)
  }, [])

  /**
   * Lee una respuesta con half-duplex estricto: corta el micrófono antes de
   * hablar y lo retoma 350 ms después de `onend` (o de inmediato si el doctor
   * usó «Interrumpir y hablar»). `force` saltea la preferencia de voz: «repetir»
   * siempre se escucha.
   */
  const speak = useCallback(
    (text: string, force = false) => {
      if ((!force && !voiceRef.current) || !text.trim() || !isAssistantSpeechSupported()) return

      const shouldResume = listeningRef.current || continuousRef.current

      if (listeningRef.current) {
        listeningRef.current = false
        dictationRef.current?.stop()
        setIsListening(false)
      }

      clearResumeTimer()
      stopSilenceTicker()
      setIsSpeaking(true)

      const started = speakAssistant(text, {
        onStart: () => setIsSpeaking(true),
        onEnd: () => {
          setIsSpeaking(false)

          if (!shouldResume) return

          clearResumeTimer()
          resumeTimerRef.current = window.setTimeout(() => {
            resumeTimerRef.current = null

            // El doctor ya prendió el micrófono, cerró el panel o el motor sigue
            // hablando: no se duplica la escucha.
            if (!dockOpenRef.current || listeningRef.current || isAssistantSpeaking()) return

            beginDictationRef.current()
          }, ASSISTANT_SPEECH_RESUME_DELAY_MS)
        },
      })

      if (!started) setIsSpeaking(false)
    },
    [clearResumeTimer, stopSilenceTicker],
  )

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

  // El dictado se crea una sola vez: siempre ejecuta el submit del render actual.
  useEffect(() => {
    submitCommandRef.current = (text: string) => {
      void submitCommand(text)
    }
  }, [submitCommand])

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

    const dictation = createSpeechDictation(
      {
        onTranscript: (final, interim) => {
          setInterimTranscript(interim)

          const combined = `${final} ${interim}`.replace(/\s+/g, ' ').trim()

          if (!combined) return

          noteVoiceActivity()

          // «…listo» / «…ejecutar»: no se espera la ventana de silencio.
          if (FLUSH_KEYWORD.test(combined)) dictationRef.current?.flush()
        },
        onPhrase: (phrase) => {
          stopSilenceTicker()
          setInterimTranscript('')

          const command = stripFlushKeyword(phrase)

          if (!command) return

          submitCommandRef.current(command)
        },
        onError: (message) => {
          // Un error del micrófono no debe reabrir la escucha al terminar de hablar.
          listeningRef.current = false
          setIsListening(false)
          clearResumeTimer()
          stopSilenceTicker()
          pushReply('error', message)
        },
        onStateChange: (state) => {
          setIsListening(state === 'listening')

          if (state === 'idle' && !listeningRef.current) stopSilenceTicker()
        },
      },
      { silenceMs: SILENCE_WINDOW_MS },
    )

    dictationRef.current = dictation

    return dictation
  }, [clearResumeTimer, noteVoiceActivity, pushReply, stopSilenceTicker])

  /** Prende el micrófono sin mensajes (lo usan la reactivación y el atajo). */
  const beginDictation = useCallback(() => {
    if (!isSpeechDictationSupported()) return false

    try {
      const dictation = ensureDictation()

      listeningRef.current = true
      dictation.start()
      setIsListening(true)

      return true
    } catch {
      listeningRef.current = false
      setIsListening(false)

      return false
    }
  }, [ensureDictation])

  useEffect(() => {
    beginDictationRef.current = beginDictation
  }, [beginDictation])

  const startListening = useCallback(() => {
    if (!isSpeechDictationSupported()) {
      pushReply('error', UNSUPPORTED_BROWSER_MESSAGE)

      return
    }

    clearResumeTimer()
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
  }, [clearResumeTimer, ensureDictation, pushReply])

  /** «Interrumpir y hablar»: corta la voz del copiloto y abre el micrófono. */
  const interruptSpeech = useCallback(() => {
    clearResumeTimer()
    stopAssistantSpeech()
    setIsSpeaking(false)
    setIsDockOpen(true)

    if (!beginDictation()) pushReply('error', GENERIC_ERROR)
  }, [beginDictation, clearResumeTimer, pushReply])

  /** «Silenciar»: corta la locución y deja la preferencia de voz como estaba. */
  const silenceSpeech = useCallback(() => {
    clearResumeTimer()
    stopAssistantSpeech()
    setIsSpeaking(false)
  }, [clearResumeTimer])

  const stopListening = useCallback(() => {
    clearResumeTimer()
    listeningRef.current = false
    dictationRef.current?.stop()
    setIsListening(false)
    setInterimTranscript('')
    stopSilenceTicker()
  }, [clearResumeTimer, stopSilenceTicker])

  const toggleListening = useCallback(() => {
    if (listeningRef.current) stopListening()
    else startListening()
  }, [startListening, stopListening])

  const openDock = useCallback(() => setIsDockOpen(true), [])

  const closeDock = useCallback(() => {
    clearResumeTimer()
    stopSilenceTicker()
    setIsDockOpen(false)
    listeningRef.current = false
    dictationRef.current?.stop()
    setIsListening(false)
    setInterimTranscript('')
  }, [clearResumeTimer, stopSilenceTicker])

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

  const setContinuousMode = useCallback(
    (enabled: boolean) => {
      continuousRef.current = enabled
      setContinuousModeState(enabled)

      if (!enabled) clearResumeTimer()

      try {
        window.localStorage.setItem(CONTINUOUS_STORAGE_KEY, enabled ? 'on' : 'off')
      } catch {
        // Modo privado sin `localStorage`: la preferencia dura la sesión.
      }
    },
    [clearResumeTimer],
  )

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

      if (resumeTimerRef.current !== null) window.clearTimeout(resumeTimerRef.current)
      if (silenceTickerRef.current !== null) window.clearInterval(silenceTickerRef.current)
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
      continuousMode,
      silenceProgress,
      isSpeechSupported: isSpeechDictationSupported(),
      isAiConfigured: isGeminiConfigured(),
      openDock,
      closeDock,
      toggleDock,
      startListening,
      stopListening,
      toggleListening,
      interruptSpeech,
      silenceSpeech,
      submitCommand: (text: string) => {
        void submitCommand(text)
      },
      confirmPendingAction: () => {
        void confirmPendingAction()
      },
      cancelPendingAction,
      setVoiceFeedbackEnabled,
      setContinuousMode,
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
      continuousMode,
      finishGuidedConsultation,
      guidedCompleted,
      guidedStep,
      guidedStepId,
      interimTranscript,
      interruptSpeech,
      isDockOpen,
      isListening,
      isProcessing,
      isSpeaking,
      openDock,
      pendingConfirmation,
      repeatReply,
      runGuidedStep,
      setActivePatient,
      setContinuousMode,
      setVoiceFeedbackEnabled,
      silenceProgress,
      silenceSpeech,
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

