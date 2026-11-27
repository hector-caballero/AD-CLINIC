/**
 * Voz del copiloto clínico con `window.speechSynthesis`.
 *
 * Es la contraparte de `speech-dictation.ts`: el reconocedor escucha al doctor
 * y esta utilidad lee la respuesta del asistente. Se prefiere `es-PY` (Paraguay)
 * y, si el motor del navegador no tiene ese locale, cae a otros españoles.
 *
 * Reglas:
 * - Una sola locución a la vez: al pedir una nueva se cancela la anterior (el
 *   doctor puede interrumpir y el micrófono vuelve a escuchar).
 * - Half-duplex: el proveedor corta el micrófono antes de hablar y lo retoma
 *   `ASSISTANT_SPEECH_RESUME_DELAY_MS` después de `onEnd`, así el copiloto
 *   nunca se escucha a sí mismo ni habla encima del doctor.
 * - Cada locución tiene un token de generación: cuando se cancela, el `onEnd`
 *   viejo se descarta y no puede reactivar el micrófono por detrás.
 * - `speakAssistant` devuelve `false` si el navegador no puede hablar o si el
 *   interruptor de voz está apagado en el contexto; nunca lanza.
 */

const SPEECH_LANG_CANDIDATES = ['es-py', 'es-es', 'es-ar', 'es-mx', 'es']

/**
 * Espera después de `utterance.onend` antes de reactivar el micrófono.
 * Chrome tarda unos milisegundos en soltar el altavoz; si se escucha antes,
 * el dictado captura la última sílaba del propio copiloto.
 */
export const ASSISTANT_SPEECH_RESUME_DELAY_MS = 350

let activeUtterance: SpeechSynthesisUtterance | null = null

/**
 * Token de la locución vigente. `stopAssistantSpeech()` lo incrementa para que
 * los callbacks de una locución cancelada no se disparen.
 */
let generation = 0

export function isAssistantSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** `true` mientras el motor de síntesis está emitiendo audio. */
export function isAssistantSpeaking(): boolean {
  if (!isAssistantSpeechSupported()) return false

  try {
    return window.speechSynthesis.speaking
  } catch {
    return false
  }
}

function pickSpanishVoice(): SpeechSynthesisVoice | null {
  if (!isAssistantSpeechSupported()) return null

  const voices = window.speechSynthesis.getVoices()

  for (const lang of SPEECH_LANG_CANDIDATES) {
    const match = voices.find((voice) => voice.lang.toLowerCase() === lang)

    if (match) return match
  }

  return voices.find((voice) => voice.lang.toLowerCase().startsWith('es')) ?? null
}

/** Corta la locución en curso (también sirve antes de abrir el micrófono). */
export function stopAssistantSpeech(): void {
  if (!isAssistantSpeechSupported()) return

  // Invalida los callbacks de la locución que se está cortando.
  generation += 1
  activeUtterance = null

  try {
    window.speechSynthesis.cancel()
  } catch {
    // Algunos motores fallan si nunca se habló: no hay nada que cortar.
  }
}

export type AssistantSpeechHandlers = {
  onStart?: () => void
  /** Se llama al terminar, al fallar o al cancelar la locución. */
  onEnd?: () => void
}

/**
 * Lee una respuesta en voz alta.
 * Devuelve `false` cuando el navegador no soporta síntesis o el texto quedó vacío.
 */
export function speakAssistant(
  text: string,
  handlers: AssistantSpeechHandlers = {},
): boolean {
  if (!isAssistantSpeechSupported()) return false

  const content = text.replace(/\s+/g, ' ').trim()

  if (!content) return false

  stopAssistantSpeech()

  // La cancelación de arriba incrementa la generación: este token identifica
  // la locución nueva y descarta los callbacks de la anterior.
  const token = generation

  try {
    const utterance = new SpeechSynthesisUtterance(content)
    const voice = pickSpanishVoice()

    utterance.lang = voice?.lang ?? 'es-PY'
    utterance.rate = 1.02
    utterance.pitch = 1
    utterance.volume = 1

    if (voice) utterance.voice = voice

    let finished = false
    const finish = () => {
      if (finished) return

      finished = true

      // Locución cancelada: no se avisa el final para que el proveedor no
      // reactive el micrófono encima de la locución que la reemplazó.
      if (token !== generation) return

      if (activeUtterance === utterance) activeUtterance = null

      handlers.onEnd?.()
    }

    utterance.onstart = () => {
      if (token === generation) handlers.onStart?.()
    }
    utterance.onend = finish
    utterance.onerror = finish

    activeUtterance = utterance
    window.speechSynthesis.speak(utterance)

    return true
  } catch {
    activeUtterance = null

    return false
  }
}
