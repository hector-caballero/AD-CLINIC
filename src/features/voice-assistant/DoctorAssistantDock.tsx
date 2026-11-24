import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  Bot,
  CircleCheck,
  Info,
  Loader2,
  Mic,
  MicOff,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { getPatientFullName } from '../patients/patient-types'
import { useDoctorAssistant } from './assistant-context'
import type {
  AssistantConfirmation,
  AssistantReply,
  AssistantReplyTone,
  GuidedStepDefinition,
} from './assistant-types'

/**
 * Dock flotante del copiloto clínico.
 *
 * Única interfaz del `DoctorAssistantProvider`: se monta una sola vez en
 * `AppLayout` y por eso el micrófono y la guía siguen vivos al cambiar de
 * pantalla. Reglas de diseño:
 * - El botón flotante solo abre/cierra el panel; el micrófono se prende desde
 *   el dock (o con `Alt + V`) para no pedir permiso en cada pantalla.
 * - Las acciones sensibles no se ejecutan al dictarlas: el proveedor deja una
 *   tarjeta con Confirmar / Cancelar y acá solo se dibuja.
 * - El texto dictado y la respuesta se anuncian con `aria-live` para que el
 *   flujo por voz sea usable con lector de pantalla.
 */

const TONE_STYLES: Record<AssistantReplyTone, { box: string; icon: string }> = {
  info: { box: 'bg-slate-100 text-slate-700 ring-slate-200', icon: 'text-slate-500' },
  success: { box: 'bg-emerald-50 text-emerald-800 ring-emerald-200', icon: 'text-emerald-600' },
  warning: { box: 'bg-amber-50 text-amber-900 ring-amber-200', icon: 'text-amber-600' },
  error: { box: 'bg-red-50 text-red-700 ring-red-200', icon: 'text-red-600' },
}

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-3.5 py-2 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60'

const GHOST_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white/85 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'

const ICON_BUTTON =
  'inline-flex items-center justify-center rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-50'

type DockFabProps = {
  isListening: boolean
  isSpeaking: boolean
  isProcessing: boolean
  guidedStepNumber: number
  onToggle: () => void
}

/** Botón flotante de acceso (esquina inferior derecha, solo con el panel cerrado). */
function DockFab({
  isListening,
  isSpeaking,
  isProcessing,
  guidedStepNumber,
  onToggle,
}: DockFabProps) {
  const ring = isListening
    ? 'ring-emerald-500/60'
    : isSpeaking
      ? 'ring-brand-500/70'
      : 'ring-brand-500/30'

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-haspopup="dialog"
      title="Copiloto clínico (Alt + V)"
      className={`fixed right-4 bottom-4 z-50 inline-flex size-14 items-center justify-center rounded-full bg-ink-950 text-brand-300 shadow-panel ring-2 transition-transform hover:scale-105 hover:bg-ink-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 lg:right-6 lg:bottom-6 ${ring}`}
    >
      <Bot className="size-6" aria-hidden="true" />
      {isListening && (
        <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center">
          <span className="absolute inline-flex size-4 animate-ping rounded-full bg-emerald-500/60" />
          <span className="relative inline-flex size-3 rounded-full bg-emerald-500 ring-2 ring-white" />
        </span>
      )}
      {!isListening && isProcessing && (
        <span className="absolute -top-0.5 -right-0.5 inline-flex size-4 items-center justify-center rounded-full bg-white ring-2 ring-white">
          <Loader2 className="size-3.5 animate-spin text-brand-600" aria-hidden="true" />
        </span>
      )}
      {guidedStepNumber > 0 && (
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-brand-500 px-1.5 text-[10px] font-semibold text-ink-950 ring-1 ring-white">
          {guidedStepNumber}
        </span>
      )}
    </button>
  )
}

type GuidedStepCardProps = {
  step: GuidedStepDefinition
  stepNumber: number
  totalSteps: number
  completedCount: number
  isProcessing: boolean
  onRunStep: () => void
  onNext: () => void
  onClose: () => void
  onFinishConsultation: () => void
}

/** Paso actual del «Modo Guía de Consulta» con su progreso. */
function GuidedStepCard({
  step,
  stepNumber,
  totalSteps,
  completedCount,
  isProcessing,
  onRunStep,
  onNext,
  onClose,
  onFinishConsultation,
}: GuidedStepCardProps) {
  const progress = Math.round((completedCount / Math.max(totalSteps, 1)) * 100)

  return (
    <div className="rounded-2xl bg-brand-50/80 p-3 ring-1 ring-brand-200">
      <div className="flex items-start justify-between gap-2">
        <p className="pt-1 text-[10px] font-semibold tracking-[0.16em] text-brand-800 uppercase">
          Modo guía · paso {stepNumber} de {totalSteps}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar modo guía"
          title="Cerrar modo guía"
          className={ICON_BUTTON}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <p className="text-sm font-semibold text-ink-900">{step.label}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{step.hint}</p>

      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/80 ring-1 ring-brand-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={totalSteps}
        aria-valuenow={completedCount}
        aria-label="Pasos completados de la consulta"
      >
        <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2">
        <button type="button" onClick={onRunStep} disabled={isProcessing} className={PRIMARY_BUTTON}>
          {step.label}
        </button>
        <button type="button" onClick={onNext} disabled={isProcessing} className={GHOST_BUTTON}>
          Siguiente paso
        </button>
        <button
          type="button"
          onClick={onFinishConsultation}
          disabled={isProcessing}
          className={GHOST_BUTTON}
        >
          Cerrar consulta
        </button>
      </div>
    </div>
  )
}

type ReplyBlockProps = {
  reply: AssistantReply | null
  onRepeat: () => void
}

/** Última respuesta del copiloto (con enlace opcional, p. ej. WhatsApp). */
function ReplyBlock({ reply, onRepeat }: ReplyBlockProps) {
  if (!reply) {
    return (
      <p className="rounded-xl bg-white/70 px-3 py-2 text-xs leading-relaxed text-slate-500 ring-1 ring-slate-200">
        Decí «llamar al siguiente», «leer alertas», «estado de cuenta», «agendá control» o «abrí
        el odontograma de…». También podés escribirlo abajo.
      </p>
    )
  }

  const tone = TONE_STYLES[reply.tone]
  const Icon = reply.tone === 'success' ? CircleCheck : reply.tone === 'info' ? Info : AlertTriangle

  return (
    <div key={reply.id} className={`rounded-xl px-3 py-2 ring-1 ${tone.box}`}>
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 size-4 shrink-0 ${tone.icon}`} aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm leading-relaxed" role="status" aria-live="polite">
          {reply.text}
        </p>
        <button
          type="button"
          onClick={onRepeat}
          aria-label="Repetir la respuesta en voz alta"
          title="Repetir en voz alta"
          className={ICON_BUTTON}
        >
          <Volume2 className="size-4" aria-hidden="true" />
        </button>
      </div>

      {reply.link && (
        <a
          href={reply.link.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/80 px-2.5 py-1.5 text-xs font-semibold text-ink-900 ring-1 ring-slate-300 transition-colors hover:bg-white"
        >
          {reply.link.label}
        </a>
      )}
    </div>
  )
}

type ConfirmationCardProps = {
  confirmation: AssistantConfirmation
  isProcessing: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Tarjeta de confirmación: nada sensible se ejecuta sin este «sí». */
function ConfirmationCard({
  confirmation,
  isProcessing,
  onConfirm,
  onCancel,
}: ConfirmationCardProps) {
  return (
    <div className="rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-300">
      <div className="flex items-start gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <AlertTriangle className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-900">{confirmation.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-amber-800">{confirmation.detail}</p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} disabled={isProcessing} className={GHOST_BUTTON}>
          Cancelar
        </button>
        <button type="button" onClick={onConfirm} disabled={isProcessing} className={PRIMARY_BUTTON}>
          {isProcessing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <CircleCheck className="size-4" aria-hidden="true" />
          )}
          {isProcessing ? 'Ejecutando…' : confirmation.confirmLabel}
        </button>
      </div>
    </div>
  )
}

/**
 * Panel del copiloto: paciente activo, guía, última respuesta, tarjeta de
 * confirmación y los controles de micrófono/voz. Se abre con el botón flotante
 * o con `Alt + V` (el atajo vive en el proveedor).
 */
export function DoctorAssistantDock() {
  const {
    activePatient,
    isListening,
    isSpeaking,
    isProcessing,
    isDockOpen,
    transcript,
    interimTranscript,
    assistantReply,
    pendingConfirmation,
    guidedStep,
    guidedStepNumber,
    guidedCompleted,
    totalGuidedSteps,
    voiceFeedbackEnabled,
    isSpeechSupported,
    isAiConfigured,
    closeDock,
    toggleDock,
    toggleListening,
    submitCommand,
    confirmPendingAction,
    cancelPendingAction,
    setVoiceFeedbackEnabled,
    startGuidedWorkflow,
    advanceGuidedWorkflow,
    closeGuidedWorkflow,
    finishGuidedConsultation,
    runGuidedStep,
    repeatReply,
  } = useDoctorAssistant()

  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Escape cierra el panel (Alt + V lo abre y prende el micrófono).
  useEffect(() => {
    if (!isDockOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDock()
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeDock, isDockOpen])

  // Al abrir, el foco va al campo: sirve para escribir o para dictar.
  useEffect(() => {
    if (isDockOpen) inputRef.current?.focus()
  }, [isDockOpen])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const command = draft.trim()

    if (!command) return

    setDraft('')
    submitCommand(command)
  }

  const liveText = interimTranscript || transcript

  return (
    <>
      {!isDockOpen && (
        <DockFab
          isListening={isListening}
          isSpeaking={isSpeaking}
          isProcessing={isProcessing}
          guidedStepNumber={guidedStepNumber}
          onToggle={toggleDock}
        />
      )}

      {isDockOpen && (
        <section
          id="assistant-dock"
          role="dialog"
          aria-label="Copiloto clínico"
          className="fixed inset-x-3 bottom-3 z-50 flex max-h-[82svh] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-canvas/95 shadow-panel backdrop-blur-xl sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[26rem] lg:w-[28rem]"
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-slate-200/70 px-3 py-2.5">
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink-950 text-brand-300"
            >
              <Bot className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink-900">Copiloto clínico</p>
              <p className="truncate text-[11px] text-slate-500">
                {activePatient ? getPatientFullName(activePatient) : 'Sin paciente activo'}
              </p>
            </div>
            {isSpeaking && (
              <span className="hidden items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-800 ring-1 ring-brand-200 sm:inline-flex">
                <Volume2 className="size-3" aria-hidden="true" />
                Hablando
              </span>
            )}
            {isAiConfigured && (
              <span
                title="Los comandos que el parser local no entiende se interpretan con Gemini Flash."
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-800 ring-1 ring-brand-200"
              >
                <Sparkles className="size-3" aria-hidden="true" />
                IA
              </span>
            )}
            <button
              type="button"
              onClick={closeDock}
              aria-label="Cerrar copiloto"
              title="Cerrar (Esc)"
              className={ICON_BUTTON}
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
            {guidedStep ? (
              <GuidedStepCard
                step={guidedStep}
                stepNumber={guidedStepNumber}
                totalSteps={totalGuidedSteps}
                completedCount={guidedCompleted.length}
                isProcessing={isProcessing}
                onRunStep={runGuidedStep}
                onNext={advanceGuidedWorkflow}
                onClose={closeGuidedWorkflow}
                onFinishConsultation={finishGuidedConsultation}
              />
            ) : (
              <button
                type="button"
                onClick={startGuidedWorkflow}
                disabled={isProcessing}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-brand-300 bg-brand-50/60 px-3 py-2 text-xs font-semibold text-brand-800 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Sparkles className="size-3.5" aria-hidden="true" />
                Iniciar modo guía de consulta
              </button>
            )}

            <ReplyBlock reply={assistantReply} onRepeat={repeatReply} />

            {pendingConfirmation && (
              <ConfirmationCard
                confirmation={pendingConfirmation}
                isProcessing={isProcessing}
                onConfirm={confirmPendingAction}
                onCancel={cancelPendingAction}
              />
            )}

            {(liveText || isListening) && (
              <div className="rounded-xl bg-white/85 px-3 py-2 ring-1 ring-slate-200">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-slate-400 uppercase">
                  <Mic className="size-3" aria-hidden="true" />
                  {isListening ? 'Escuchando…' : 'Último comando'}
                </p>
                <p className="mt-1 text-sm leading-relaxed" aria-live="polite">
                  {interimTranscript ? (
                    <span className="italic text-slate-500">{interimTranscript}</span>
                  ) : transcript ? (
                    <span className="text-slate-700">“{transcript}”</span>
                  ) : (
                    <span className="italic text-slate-500">Hablá ahora: te escucho.</span>
                  )}
                </p>
              </div>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className="shrink-0 space-y-2 border-t border-slate-200/70 px-3 py-2.5"
          >
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Escribí un comando…"
                aria-label="Comando para el copiloto"
                autoComplete="off"
                className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white/90 px-3 py-2 text-sm text-ink-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 focus:outline-none"
              />
              <button type="submit" disabled={!draft.trim() || isProcessing} className={PRIMARY_BUTTON}>
                Enviar
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={toggleListening}
                disabled={!isSpeechSupported || isProcessing}
                aria-pressed={isListening}
                title={isListening ? 'Detener el micrófono' : 'Hablar con el copiloto (Alt + V)'}
                className={
                  isListening
                    ? 'inline-flex items-center justify-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 shadow-sm ring-1 ring-red-200 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50'
                    : GHOST_BUTTON
                }
              >
                {isListening ? (
                  <Square className="size-4" aria-hidden="true" />
                ) : (
                  <Mic className="size-4" aria-hidden="true" />
                )}
                {isListening ? 'Detener' : 'Hablar'}
              </button>

              <button
                type="button"
                onClick={() => setVoiceFeedbackEnabled(!voiceFeedbackEnabled)}
                disabled={isProcessing}
                aria-pressed={voiceFeedbackEnabled}
                title="Respuestas en voz alta"
                className={GHOST_BUTTON}
              >
                {voiceFeedbackEnabled ? (
                  <Volume2 className="size-4" aria-hidden="true" />
                ) : (
                  <VolumeX className="size-4" aria-hidden="true" />
                )}
                {voiceFeedbackEnabled ? 'Voz on' : 'Voz off'}
              </button>

              <span className="ml-auto hidden items-center gap-1 text-[10px] text-slate-400 sm:inline-flex">
                <MicOff className="size-3" aria-hidden="true" />
                Alt + V
              </span>
            </div>

            {!isSpeechSupported && (
              <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
                Este navegador no soporta dictado por voz. Escribí el comando y el copiloto hace lo
                mismo.
              </p>
            )}

            <p className="text-[10px] leading-relaxed text-slate-400">
              Llamar a la sala, agendar un control y guardar en el odontograma piden confirmación
              antes de tocar la base.
            </p>
          </form>
        </section>
      )}
    </>
  )
}

