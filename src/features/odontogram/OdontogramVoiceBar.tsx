import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CircleCheck, Loader2, Mic, Sparkles, Square, X } from 'lucide-react'
import type { SpeechDictation } from '../../services/speech-dictation'
import { useTreatments } from '../treatments/useTreatments'
import { filterTreatmentOptions } from './odontogram-catalog'
import {
  createOdontogramDictation,
  describeVoiceCommand,
  getOdontogramVoiceStatus,
  interpretVoiceCommand,
  toOdontogramDraft,
  type OdontogramVoiceCommand,
} from './odontogram-voice-service'
import type { Dentition, OdontogramDraft, ToothSelection } from './odontogram-types'

const VOICE_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm ring-1 transition-colors disabled:cursor-not-allowed disabled:opacity-60'

const PRIMARY_BUTTON_CLASS = `${VOICE_BUTTON_CLASS} bg-brand-500 text-ink-950 shadow-brand-500/30 ring-brand-600/25 hover:bg-brand-400`

const STOP_BUTTON_CLASS = `${VOICE_BUTTON_CLASS} bg-slate-900 text-white ring-slate-900/20 hover:bg-slate-800`

type VoiceFeedback = { tone: 'success' | 'error'; message: string }

type OdontogramVoiceBarProps = {
  dentition: Dentition
  /** Guarda el procedimiento con `useOdontogram().saveItem` (puede lanzar). */
  onApply: (draft: OdontogramDraft, command: OdontogramVoiceCommand) => Promise<void>
  /** Abre el modal de la pieza cuando falta elegir el procedimiento. */
  onRequestManualEntry: (selection: ToothSelection) => void
}

/**
 * Barra de **dictado manos libres** del odontograma.
 *
 * Escucha en continuo y aplica cada frase cerrada por el navegador: el parser
 * rápido (sin red) o Gemini Flash resuelven pieza, cara, procedimiento y
 * estado, y el registro se guarda con las mismas acciones que usa el modal de
 * la pieza. El estado en vivo muestra «Escuchando…», el texto provisorio del
 * reconocedor y la confirmación con el formato `Pieza 16 (Oclusal) → …`. Si el
 * procedimiento no se resuelve, abre la ficha de la pieza con la selección ya
 * hecha.
 *
 * Las frases se procesan en fila (`queueRef`) para que dos comandos seguidos no
 * se pisen al guardar.
 */
export function OdontogramVoiceBar({
  dentition,
  onApply,
  onRequestManualEntry,
}: OdontogramVoiceBarProps) {
  const [voiceStatus] = useState(() => getOdontogramVoiceStatus())
  const { treatments, isLoading: isLoadingCatalog, error: catalogError } = useTreatments()
  const options = useMemo(() => filterTreatmentOptions(treatments, ''), [treatments])

  const [isListening, setIsListening] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [interim, setInterim] = useState('')
  const [lastPhrase, setLastPhrase] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<VoiceFeedback | null>(null)

  const dictationRef = useRef<SpeechDictation | null>(null)
  const queueRef = useRef<Promise<void>>(Promise.resolve())

  /**
   * Procesamiento de una frase. Vive en un ref actualizado en cada render para
   * que el reconocedor (creado una sola vez) use siempre el catálogo, la
   * dentición y los callbacks vigentes.
   */
  const applyRef = useRef<(phrase: string) => Promise<void>>(async () => {})

  useEffect(() => {
    applyRef.current = async (phrase) => {
      setIsProcessing(true)

      try {
        const result = await interpretVoiceCommand(phrase, { treatments: options, dentition })

        if (!result.command) {
          setFeedback({
            tone: 'error',
            message: result.message ?? 'No pude interpretar el dictado.',
          })

          if (result.pendingSelection) onRequestManualEntry(result.pendingSelection)

          return
        }

        await onApply(toOdontogramDraft(result.command), result.command)
        setFeedback({ tone: 'success', message: describeVoiceCommand(result.command) })
      } catch (cause) {
        setFeedback({
          tone: 'error',
          message: cause instanceof Error ? cause.message : 'No se pudo registrar el dictado.',
        })
      } finally {
        setIsProcessing(false)
        setInterim('')
      }
    }
  })

  useEffect(
    () => () => {
      dictationRef.current?.dispose()
    },
    [],
  )

  const canUseVoice = voiceStatus.supported && !isLoadingCatalog

  function enqueue(phrase: string) {
    setLastPhrase(phrase)
    queueRef.current = queueRef.current
      .then(() => applyRef.current(phrase))
      .catch(() => {
        // El error ya se muestra en la barra (`feedback`).
      })
  }

  function toggleDictation() {
    if (isListening) {
      dictationRef.current?.stop()
      return
    }

    if (!dictationRef.current) {
      try {
        dictationRef.current = createOdontogramDictation({
          onPhrase: (phrase) => enqueue(phrase),
          onInterim: (text) => setInterim(text),
          onStateChange: (state) => setIsListening(state === 'listening'),
          onError: (message) => {
            setIsListening(false)
            setFeedback({ tone: 'error', message })
          },
        })
      } catch (cause) {
        setFeedback({
          tone: 'error',
          message:
            cause instanceof Error ? cause.message : 'No se pudo iniciar el dictado por voz.',
        })

        return
      }
    }

    setFeedback(null)
    setInterim('')
    setLastPhrase(null)
    dictationRef.current.reset()
    dictationRef.current.start()
  }

  const liveText = interim || lastPhrase

  return (
    <section
      aria-label="Dictado manos libres del odontograma"
      aria-busy={isProcessing}
      className="rounded-2xl border border-brand-200/80 bg-gradient-to-br from-white/90 via-brand-50/60 to-white/85 p-3 shadow-card backdrop-blur-md sm:p-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className={[
              'flex size-10 shrink-0 items-center justify-center rounded-2xl transition-colors',
              isListening
                ? 'bg-brand-500 text-ink-950 shadow-sm shadow-brand-500/30'
                : 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
            ].join(' ')}
          >
            <Mic className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">Dictado manos libres</h3>
            <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-slate-500">
              Decí «pieza 16 oclusal caries», «pieza 46 mesial resina pendiente» o «pieza 21
              ausente». El registro entra solo en el odontograma y en el presupuesto.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isProcessing ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              Procesando…
            </span>
          ) : isListening ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">
              <span
                className="size-1.5 animate-pulse rounded-full bg-emerald-500"
                aria-hidden="true"
              />
              Escuchando…
            </span>
          ) : null}

          <button
            type="button"
            onClick={toggleDictation}
            disabled={!canUseVoice}
            aria-pressed={isListening}
            title={voiceStatus.warning ?? 'Iniciar el dictado del odontograma'}
            className={isListening ? STOP_BUTTON_CLASS : PRIMARY_BUTTON_CLASS}
          >
            {isListening ? (
              <Square className="size-4" aria-hidden="true" />
            ) : (
              <Mic className="size-4" aria-hidden="true" />
            )}
            {isListening ? 'Detener dictado' : 'Dictar'}
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex items-start gap-2 rounded-xl bg-white/85 px-3 py-2 text-sm ring-1 ring-slate-200">
          <span className="min-w-0 flex-1 leading-relaxed" aria-live="polite">
            {liveText ? (
              <span className={interim ? 'italic text-slate-500' : 'text-slate-700'}>
                {interim ? `“${interim}”` : `Último comando: “${lastPhrase}”`}
              </span>
            ) : (
              <span className="text-slate-400">
                {isLoadingCatalog
                  ? 'Cargando el catálogo de tratamientos…'
                  : isListening
                    ? 'Esperando el comando…'
                    : 'El micrófono está apagado.'}
              </span>
            )}
          </span>
          {voiceStatus.aiEnabled && (
            <span
              title="Los comandos que el parser rápido no entiende se interpretan con Gemini Flash."
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-800 ring-1 ring-brand-200"
            >
              <Sparkles className="size-3" aria-hidden="true" />
              IA
            </span>
          )}
        </div>

        {feedback && (
          <div
            role={feedback.tone === 'error' ? 'alert' : 'status'}
            className={[
              'flex items-start justify-between gap-3 rounded-xl px-3 py-2 text-sm ring-1',
              feedback.tone === 'success'
                ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                : 'bg-red-50 text-red-700 ring-red-200',
            ].join(' ')}
          >
            <span className="flex items-start gap-2">
              {feedback.tone === 'success' ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              ) : (
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              )}
              {feedback.message}
            </span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              aria-label="Cerrar aviso del dictado"
              className="-mr-1 shrink-0 rounded-lg p-1 transition-colors hover:bg-white/60"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {voiceStatus.warning && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 ring-1 ring-amber-200">
            {voiceStatus.warning}
          </p>
        )}

        {catalogError && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-[11px] leading-relaxed text-red-700 ring-1 ring-red-200">
            {catalogError}
          </p>
        )}

        <p className="text-[11px] leading-relaxed text-slate-400">
          Estados: pendiente · presupuestado · realizado · ausente. Caras: oclusal (o incisal),
          vestibular (bucal/labial), lingual (palatino), mesial y distal. Si el procedimiento no
          está en el catálogo, la ficha de la pieza se abre con la selección hecha.
        </p>
      </div>
    </section>
  )
}

