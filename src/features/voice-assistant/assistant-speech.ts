/**
 * Voz del copiloto clínico con `window.speechSynthesis`.
 *
 * Es la contraparte de `speech-dictation.ts`: el reconocedor escucha al doctor
 * y esta utilidad lee la respuesta del asistente. Se prefiere `es-PY` (Paraguay)
 * y, si el motor del navegador no tiene ese locale, cae a otros españoles.
 *
 * Reglas:
 * - Una sola locución a la vez: al pedir una nueva se cancela la anterior (el
 *   doctor puede interrumpir con `Alt + V` y el micrófono vuelve a escuchar).
 * - `speakAssistant` devuelve `false` si el navegador no puede hablar o si el
 *   interruptor de voz está apagado en el contexto; nunca lanza.
 */

const SPEECH_LANG_CANDIDATES = ['es-py', 'es-es', 'es-ar', 'es-mx', 'es']

let activeUtterance: SpeechSynthesisUtterance | null = null

export function isAssistantSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
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

      if (activeUtterance === utterance) activeUtterance = null

      handlers.onEnd?.()
    }

    utterance.onstart = () => handlers.onStart?.()
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
