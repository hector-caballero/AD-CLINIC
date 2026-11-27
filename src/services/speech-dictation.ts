/**
 * Dictado por voz con la Web Speech API del navegador.
 *
 * Es la transcripción nativa (`SpeechRecognition` / `webkitSpeechRecognition`):
 * gratuita y en streaming, sin subir audio a ningún servidor propio. La usan
 * dos asistentes:
 *
 * - **Anamnesis** (`createAnamnesisDictation` en `anamnesis-ai.ts`): dictado
 *   largo, con el texto final acumulado frase por frase.
 * - **Odontograma** (`createOdontogramDictation` en
 *   `features/odontogram/odontogram-voice-service.ts`): comandos cortos, uno
 *   por frase (`onPhrase`), que se registran en cuanto se cierran.
 * - **Copiloto clínico** (`DoctorAssistantProvider`): comandos largos dichos
 *   con pausas para pensar. Pide `silenceMs` para acumular los tramos
 *   confirmados y entregar la frase completa recién después de ese silencio
 *   (o cuando el doctor dice «listo» y el proveedor llama a `flush()`).
 *
 * `lib.dom` todavía no declara `SpeechRecognition`, así que acá se describe
 * solo lo que se usa. Chrome, Edge y Safari lo exponen con prefijo `webkit`.
 */

type SpeechAlternative = { transcript: string; confidence: number }

type SpeechResult = { isFinal: boolean; length: number; [index: number]: SpeechAlternative }

type SpeechResultList = { length: number; [index: number]: SpeechResult }

type SpeechResultEvent = { resultIndex: number; results: SpeechResultList }

type SpeechErrorEvent = { error: string; message?: string }

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null

  const candidate = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }

  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null
}

/** `true` si el navegador puede transcribir voz (Chrome, Edge y Safari sí). */
export function isSpeechDictationSupported(): boolean {
  return getSpeechRecognition() !== null
}

/**
 * Idioma del dictado: español de Paraguay. Si el motor del navegador no tiene
 * ese locale, `es-PY` cae solo a español neutro; el vocabulario odontológico se
 * reconoce igual.
 */
const DICTATION_LANG = 'es-PY'

export const UNSUPPORTED_BROWSER_MESSAGE =
  'Este navegador no soporta dictado por voz (Web Speech API). Usá Chrome o Edge actualizados.'

const MIC_PERMISSION_MESSAGE =
  'El navegador bloqueó el micrófono. Habilitá el permiso desde el candado de la barra de direcciones y volvé a intentar.'

const MIC_MISSING_MESSAGE = 'No se encontró un micrófono disponible. Conectá uno y volvé a intentar.'

const DICTATION_NETWORK_MESSAGE =
  'El servicio de dictado del navegador no respondió. Revisá la conexión a internet y volvé a intentar.'

/** Error del micrófono o del motor de dictado, con mensaje listo para mostrar. */
export class SpeechDictationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SpeechDictationError'
  }
}

export type SpeechDictationHandlers = {
  /** Texto final acumulado y el fragmento provisorio que todavía se escucha. */
  onTranscript?: (finalText: string, interimText: string) => void
  /** Cada bloque finalizado por separado: un comando por frase. */
  onPhrase?: (phrase: string) => void
  onError: (message: string) => void
  onStateChange?: (state: 'listening' | 'idle') => void
}

export type SpeechDictation = {
  start: () => void
  stop: () => void
  /** Corta el micrófono y descarta los callbacks (al cerrar el modal o la página). */
  dispose: () => void
  /** Descarta el texto acumulado para empezar un dictado nuevo. */
  reset: () => void
  /**
   * Entrega ya el texto que está esperando la ventana de silencio (el doctor
   * dijo «listo» / «ejecutar»). No hace nada si no hay texto pendiente.
   */
  flush: () => void
}

export type SpeechDictationOptions = {
  /**
   * Ventana de silencio (ms) antes de entregar la frase acumulada.
   *
   * Con `0` (u omitido) cada tramo final se entrega al instante, que es lo que
   * esperan el odontograma y la anamnesis. El copiloto usa `2000` para no
   * cortar el comando cuando el doctor hace una pausa.
   */
  silenceMs?: number
}


/**
 * Crea un dictado continuo en español.
 *
 * Chrome corta la sesión después de unos segundos de silencio (`onend`), así
 * que mientras el usuario siga dictando se reinicia sola: es lo que espera un
 * odontólogo que habla pausado. `stop()` es el único que termina de verdad.
 *
 * Lanza `SpeechDictationError` si el navegador no soporta la API.
 */
export function createSpeechDictation(
  handlers: SpeechDictationHandlers,
  options: SpeechDictationOptions = {},
): SpeechDictation {
  const Recognition = getSpeechRecognition()

  if (!Recognition) {
    throw new SpeechDictationError(UNSUPPORTED_BROWSER_MESSAGE)
  }

  const recognition = new Recognition()
  recognition.lang = DICTATION_LANG
  recognition.continuous = true
  recognition.interimResults = true
  recognition.maxAlternatives = 1

  const silenceMs = Math.max(0, Math.round(options.silenceMs ?? 0))

  let finalText = ''
  let interimText = ''
  let pendingPhrase = ''
  let silenceTimer: ReturnType<typeof setTimeout> | null = null
  let shouldListen = false
  let disposed = false

  const emitTranscript = () => {
    if (!disposed) handlers.onTranscript?.(finalText, interimText)
  }

  const clearSilenceTimer = () => {
    if (silenceTimer === null) return

    clearTimeout(silenceTimer)
    silenceTimer = null
  }

  /**
   * Entrega la frase acumulada. Se llama al vencer la ventana de silencio o
   * cuando el doctor pide ejecutar; el buffer se vacía siempre para que el
   * próximo comando arranque limpio.
   */
  const flushPending = () => {
    clearSilenceTimer()

    const phrase = pendingPhrase

    pendingPhrase = ''

    if (disposed || !phrase) return

    if (silenceMs > 0) {
      // El texto ya se entregó: se limpia el transcript visible para que la
      // próxima orden no arrastre la anterior.
      finalText = ''
      interimText = ''
      emitTranscript()
    }

    handlers.onPhrase?.(phrase)
  }

  const scheduleFlush = () => {
    if (silenceMs <= 0) return

    clearSilenceTimer()
    silenceTimer = setTimeout(flushPending, silenceMs)
  }

  const appendPhrase = (phrase: string) => {
    if (silenceMs <= 0) {
      handlers.onPhrase?.(phrase)

      return
    }

    pendingPhrase = `${pendingPhrase} ${phrase}`.replace(/\s+/g, ' ').trim()
    scheduleFlush()
  }

  recognition.onresult = (event) => {
    // Después de `stop()` pueden llegar resultados tardíos del motor: se
    // descartan para que no se ejecute un comando que el doctor ya cortó.
    if (disposed || !shouldListen) return

    let interim = ''
    let phrase = ''

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]
      const text = result?.[0]?.transcript ?? ''

      if (result?.isFinal) {
        finalText = `${finalText} ${text}`.replace(/\s+/g, ' ').trimStart()
        phrase = `${phrase} ${text}`.replace(/\s+/g, ' ').trim()
      } else {
        interim = `${interim} ${text}`.replace(/\s+/g, ' ').trimStart()
      }
    }

    interimText = interim
    emitTranscript()

    if (phrase) {
      appendPhrase(phrase)

      return
    }

    // Cada palabra provisoria corre la ventana: el doctor sigue hablando.
    if (silenceMs > 0 && pendingPhrase) scheduleFlush()
  }

  recognition.onerror = (event) => {
    switch (event.error) {
      case 'not-allowed':
      case 'service-not-allowed':
        shouldListen = false
        handlers.onError(MIC_PERMISSION_MESSAGE)
        break
      case 'audio-capture':
        shouldListen = false
        handlers.onError(MIC_MISSING_MESSAGE)
        break
      case 'network':
        shouldListen = false
        handlers.onError(DICTATION_NETWORK_MESSAGE)
        break
      case 'no-speech':
      case 'aborted':
        // Silencio normal: `onend` decide si se reinicia la escucha.
        break
      default:
        shouldListen = false
        handlers.onError(`No se pudo dictar (${event.error}). Volvé a intentar.`)
        break
    }
  }

  recognition.onstart = () => {
    if (!disposed) handlers.onStateChange?.('listening')
  }

  recognition.onend = () => {
    if (disposed) return

    if (shouldListen) {
      // Corte automático por silencio: se retoma sin perder lo ya transcripto.
      try {
        recognition.start()
        return
      } catch {
        shouldListen = false
      }
    }

    handlers.onStateChange?.('idle')
  }

  return {
    start: () => {
      if (disposed || shouldListen) return

      shouldListen = true
      interimText = ''

      try {
        recognition.start()
        handlers.onStateChange?.('listening')
      } catch {
        // `start()` falla si la sesión ya estaba activa: no es un error real.
        shouldListen = false
      }
    },
    stop: () => {
      shouldListen = false
      interimText = ''
      pendingPhrase = ''
      clearSilenceTimer()

      try {
        recognition.stop()
      } catch {
        // Detener una sesión ya cerrada no es un error.
      }

      handlers.onStateChange?.('idle')
    },
    dispose: () => {
      disposed = true
      shouldListen = false
      pendingPhrase = ''
      clearSilenceTimer()

      try {
        recognition.abort()
      } catch {
        // Si nunca arrancó, `abort()` puede lanzar: se ignora al cerrar.
      }
    },
    reset: () => {
      finalText = ''
      interimText = ''
      pendingPhrase = ''
      clearSilenceTimer()
    },
    flush: flushPending,
  }
}
