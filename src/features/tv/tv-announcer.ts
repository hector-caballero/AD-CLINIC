/**
 * Aviso sonoro de la pantalla de sala.
 *
 * Dos capas independientes, ninguna con archivos externos:
 *
 * 1. **Campanilla** de dos notas con WebAudio (siempre suena si el navegador
 *    permite audio; los navegadores exigen un gesto del usuario antes, por eso
 *    la cabecera del turnero tiene el botón de sonido que la desbloquea).
 * 2. **Voz** con `SpeechSynthesis` en español: «Paciente Ana Gómez, pasar a
 *    Box 1, por favor.». Si el dispositivo no tiene voces (o el navegador no
 *    soporta la API) queda solo la campanilla.
 *
 * La preferencia de sonido se guarda en `localStorage` para que la tele arranque
 * como quedó (una pantalla fija no debería depender de tocar el botón cada vez).
 */

const SOUND_STORAGE_KEY = 'ad-clinic-tv-sound'

/** Volumen de la campanilla (el aviso tiene que oírse en la sala, sin gritar). */
const CHIME_VOLUME = 0.18

/** Notas de la campanilla: La5 y Re6, un «ding-dong» ascendente discreto. */
const CHIME_NOTES = [880, 1174.66]

export function isSpeechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function'
  )
}

/** Preferencia guardada (`true` por defecto: la tele nace con sonido). */
export function readSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true

  try {
    const stored = window.localStorage.getItem(SOUND_STORAGE_KEY)

    return stored === null ? true : stored === 'true'
  } catch {
    return true
  }
}

export function saveSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(SOUND_STORAGE_KEY, String(enabled))
  } catch {
    // Modo privado o almacenamiento lleno: la sesión actual igual funciona.
  }
}

type AudioContextConstructor = typeof AudioContext

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null

  const legacy = window as unknown as { webkitAudioContext?: AudioContextConstructor }

  return window.AudioContext ?? legacy.webkitAudioContext ?? null
}

/** Campanilla de dos notas. Silenciosa si el navegador todavía no dio permiso. */
export function playCallChime(): void {
  const AudioContextCtor = getAudioContextConstructor()

  if (!AudioContextCtor) return

  try {
    const context = new AudioContextCtor()
    const start = context.currentTime

    CHIME_NOTES.forEach((frequency, index) => {
      const noteStart = start + index * 0.28
      const oscillator = context.createOscillator()
      const gain = context.createGain()

      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, noteStart)
      gain.gain.exponentialRampToValueAtTime(CHIME_VOLUME, noteStart + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.26)

      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.start(noteStart)
      oscillator.stop(noteStart + 0.3)
    })

    // El contexto se cierra solo: la tele puede quedar días encendida y no
    // conviene acumular contextos de audio.
    window.setTimeout(() => {
      void context.close().catch(() => undefined)
    }, 1500)
  } catch {
    // Audio bloqueado o no disponible: el aviso visual de la tele sigue.
  }
}

/** Texto que se escucha en la sala. */
export function buildCallMessage(patientName: string, room: string | null): string {
  const destination = room ? room : 'consulta'

  return `Paciente ${patientName}, pasar a ${destination}, por favor.`
}

/** Voz en español (la primera disponible; si no hay voces, la del sistema). */
function pickSpanishVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
  const voices = synth.getVoices()

  return (
    voices.find((voice) => voice.lang?.toLowerCase().startsWith('es-py')) ??
    voices.find((voice) => voice.lang?.toLowerCase().startsWith('es')) ??
    null
  )
}

/** Locución en español de un texto ya armado. */
function speakMessage(message: string): void {
  if (!isSpeechSupported()) return

  const synth = window.speechSynthesis
  const utterance = new SpeechSynthesisUtterance(message)
  const voice = pickSpanishVoice(synth)

  utterance.lang = voice?.lang ?? 'es-PY'
  utterance.rate = 0.95
  utterance.pitch = 1

  if (voice) utterance.voice = voice

  // Si hay dos llamadas seguidas, la última es la que importa.
  synth.cancel()
  synth.speak(utterance)
}

export function speakCall(patientName: string, room: string | null): void {
  speakMessage(buildCallMessage(patientName, room))
}

/**
 * La voz arranca 400 ms después de la campanilla para no pisarla.
 * El temporizador se guarda para poder cancelarlo (silenciar o salir).
 */
let voiceTimer: number | null = null

function scheduleSpeech(message: string): void {
  if (voiceTimer !== null) window.clearTimeout(voiceTimer)

  voiceTimer = window.setTimeout(() => {
    voiceTimer = null
    speakMessage(message)
  }, 400)
}

/** Campanilla + voz con el llamado. */
export function announceCall(patientName: string, room: string | null): void {
  playCallChime()
  scheduleSpeech(buildCallMessage(patientName, room))
}

/** Prueba manual desde la cabecera: también desbloquea el audio del navegador. */
export function testTvAudio(): void {
  playCallChime()
  scheduleSpeech('Sonido de la pantalla de sala activado.')
}

/** Corta cualquier locución pendiente (al desmontar la pantalla o silenciar). */
export function stopSpeaking(): void {
  if (voiceTimer !== null) {
    window.clearTimeout(voiceTimer)
    voiceTimer = null
  }

  if (isSpeechSupported()) window.speechSynthesis.cancel()
}
