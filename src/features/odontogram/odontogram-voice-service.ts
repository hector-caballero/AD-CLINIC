import {
  GeminiError,
  isGeminiConfigured,
  requestGeminiJson,
} from '../../services/gemini-flash'
import {
  UNSUPPORTED_BROWSER_MESSAGE,
  createSpeechDictation,
  isSpeechDictationSupported,
  type SpeechDictation,
} from '../../services/speech-dictation'
import { normalizeSearchTerm } from '../treatments/treatment-types'
import type { TreatmentOption } from './odontogram-catalog'
import { isValidTooth } from './odontogram-teeth'
import {
  ITEM_STATUS_META,
  getSurfaceLabel,
  type Dentition,
  type OdontogramDraft,
  type OdontogramItemStatus,
  type ToothSelection,
  type ToothSurface,
} from './odontogram-types'

/**
 * Dictado clínico del odontograma («manos libres»).
 *
 * Dos caminos, en este orden:
 *
 * 1. **Parser rápido** (`parseOdontogramCommand`): expresiones regulares sobre
 *    el texto del navegador. Entiende los comandos del día a día sin red ni
 *    cuota: «pieza 16 oclusal caries», «pieza 21 ausente», «pieza 46 mesial
 *    resina pendiente», «pieza 18 oclusal flúor presupuestado». Reconoce la
 *    pieza en números («16») o en palabras («dieciséis», «cuarenta y seis»).
 * 2. **Gemini Flash** (`parseOdontogramCommandWithGemini`): solo si el parser
 *    rápido no alcanza (frase libre, sinónimos raros, pieza mal reconocida).
 *    Recibe el catálogo de tratamientos para devolver un **nombre existente** y
 *    el JSON se sanea acá antes de tocar el odontograma.
 *
 * El comando resultante se convierte en un `OdontogramDraft` con
 * `toOdontogramDraft` y se guarda con `useOdontogram().saveItem`, así el SVG y
 * el presupuesto se refrescan igual que cuando se usa el modal de la pieza. Si
 * el procedimiento no se resuelve (o el catálogo no tiene precio), la barra
 * abre el modal de la pieza con la pieza y la cara ya elegidas.
 *
 * El estado «pieza ausente» viaja como `missing` desde Gemini (el nombre del
 * esquema pedido) y se traduce a `absent`, que es el valor de la base.
 */

/** Respuesta cruda de Gemini: la base llama `absent` a la pieza faltante. */
type GeminiVoiceStatus = 'pending' | 'budgeted' | 'completed' | 'missing'

/** Estados que acepta el esquema de Gemini. */
const GEMINI_STATUS_VALUES: GeminiVoiceStatus[] = ['pending', 'budgeted', 'completed', 'missing']

export type OdontogramVoiceCommand = {
  /** Frase original dictada. */
  raw: string
  toothNumber: number
  /** `null` = pieza completa. */
  surface: ToothSurface | null
  status: OdontogramItemStatus
  /** Hallazgo o procedimiento dictado, normalizado (minúsculas y sin tildes). */
  name: string
  /** Procedimiento del catálogo; `null` si hay que elegirlo a mano. */
  treatment: TreatmentOption | null
  /** De dónde salió la interpretación. */
  source: 'regex' | 'gemini'
}

export type OdontogramVoiceResult = {
  /** Comando listo para guardar (`null` si no se pudo interpretar). */
  command: OdontogramVoiceCommand | null
  /** Aviso para la barra de dictado cuando no se aplicó (`null` si salió bien). */
  message: string | null
  /** Pieza detectada sin procedimiento resuelto: la UI abre el modal de la pieza. */
  pendingSelection: ToothSelection | null
}

export type OdontogramVoiceStatus = {
  /** El navegador puede transcribir voz (Web Speech API). */
  supported: boolean
  /** Hay `VITE_GEMINI_API_KEY` para los comandos que el parser rápido no entiende. */
  aiEnabled: boolean
  /** Aviso a mostrar en la barra (`null` si todo está en orden). */
  warning: string | null
}

const LOCAL_PARSER_HINT =
  'Dictado rápido activo: se entienden los comandos habituales («pieza 16 oclusal caries presupuestado»). Configurá VITE_GEMINI_API_KEY para interpretar frases libres.'

/** Estado del dictado, tal como lo muestra la barra del odontograma. */
export function getOdontogramVoiceStatus(): OdontogramVoiceStatus {
  const supported = isSpeechDictationSupported()
  const aiEnabled = isGeminiConfigured()

  if (!supported) {
    return { supported, aiEnabled, warning: UNSUPPORTED_BROWSER_MESSAGE }
  }

  if (!aiEnabled) {
    return { supported, aiEnabled, warning: LOCAL_PARSER_HINT }
  }

  return { supported, aiEnabled, warning: null }
}

export type OdontogramDictationHandlers = {
  /** Cada comando cerrado por el reconocedor del navegador (una frase). */
  onPhrase: (phrase: string) => void
  /** Texto provisorio mientras el doctor habla. */
  onInterim: (text: string) => void
  onError: (message: string) => void
  onStateChange?: (state: 'listening' | 'idle') => void
}

/**
 * Dictado continuo para comandos: a diferencia de la anamnesis, acá cada frase
 * cerrada se procesa y se registra sola (`onPhrase`), sin esperar al final.
 */
export function createOdontogramDictation(
  handlers: OdontogramDictationHandlers,
): SpeechDictation {
  return createSpeechDictation({
    onPhrase: handlers.onPhrase,
    onTranscript: (_finalText, interimText) => handlers.onInterim(interimText),
    onError: handlers.onError,
    onStateChange: handlers.onStateChange,
  })
}


// --- Lectura del comando (parser rápido) --------------------------------------

/**
 * Texto comparable: minúsculas, sin tildes y sin signos. El reconocedor
 * devuelve comas y puntos («Pieza 16, oclusal: caries.»), así que se limpia
 * antes de buscar palabras clave.
 */
function normalizeSpeech(value: string): string {
  return normalizeSearchTerm(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Palabras que introducen la pieza («pieza 16», «diente 46»). */
const TOOTH_KEYWORDS = new Set(['pieza', 'piezas', 'diente', 'dientes', 'numero', 'num'])

/** Relleno entre la palabra clave y el número («pieza número 16»). */
const TOOTH_FILLERS = new Set(['numero', 'num', 'dental', 'n', 'de', 'la', 'el'])

/** Números dictados como palabras (el navegador casi siempre devuelve dígitos). */
const NUMBER_WORDS: Record<string, number> = {
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintiun: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
}

/** Decenas que se combinan con «y» + unidad («cuarenta y seis» → 46). */
const TENS = new Set([30, 40, 50, 60, 70, 80, 90])

/** Lee un número dictado en palabras y devuelve su valor y dónde termina. */
function parseNumberWord(
  tokens: string[],
  index: number,
): { value: number; next: number } | null {
  const value = NUMBER_WORDS[tokens[index]]

  if (value === undefined) return null

  if (TENS.has(value)) {
    const joiner = tokens[index + 1]
    const unit = tokens[index + 2] ? NUMBER_WORDS[tokens[index + 2]] : undefined

    if ((joiner === 'y' || joiner === 'i') && unit !== undefined && unit < 10) {
      return { value: value + unit, next: index + 3 }
    }
  }

  return { value, next: index + 1 }
}

/**
 * Pieza en notación FDI a partir del dictado.
 *
 * Acepta dígitos («16»), dígitos separados («1 6») y palabras («dieciséis»,
 * «cuarenta y seis»). Devuelve también hasta dónde llegó (`end`) para poder
 * sacar esas palabras del nombre del procedimiento.
 */
function parseTooth(tokens: string[]): { toothNumber: number; end: number } | null {
  const keywordIndex = tokens.findIndex((token) => TOOTH_KEYWORDS.has(token))
  let cursor = keywordIndex >= 0 ? keywordIndex + 1 : 0

  while (cursor < tokens.length && TOOTH_FILLERS.has(tokens[cursor])) cursor += 1

  let digits = ''

  while (cursor < tokens.length && digits.length < 2) {
    const token = tokens[cursor]

    if (/^\d{1,2}$/.test(token)) {
      digits += token
      cursor += 1
      continue
    }

    const parsed = parseNumberWord(tokens, cursor)

    if (!parsed) break

    digits += String(parsed.value)
    cursor = parsed.next

    // Una decena ya son dos dígitos: no se sigue concatenando.
    if (parsed.value >= 10) break
  }

  if (digits.length < 2) return null

  return { toothNumber: Number(digits.slice(0, 2)), end: cursor }
}

/** Sinónimos de las cinco caras. Gana la primera que aparece en la frase. */
const SURFACE_KEYWORDS: { surface: ToothSurface; words: string[] }[] = [
  {
    surface: 'occlusal',
    words: ['oclusal', 'oclusales', 'incisal', 'masticatoria', 'masticatorio'],
  },
  { surface: 'vestibular', words: ['vestibular', 'bucal', 'labial', 'externa', 'externo'] },
  { surface: 'lingual', words: ['lingual', 'palatino', 'palatina', 'interna', 'interno'] },
  { surface: 'mesial', words: ['mesial'] },
  { surface: 'distal', words: ['distal'] },
]

function extractSurface(tokens: string[]): { surface: ToothSurface; index: number } | null {
  let best: { surface: ToothSurface; index: number } | null = null

  for (const group of SURFACE_KEYWORDS) {
    for (const word of group.words) {
      const index = tokens.indexOf(word)

      if (index >= 0 && (!best || index < best.index)) {
        best = { surface: group.surface, index }
      }
    }
  }

  return best
}

/**
 * Estados explícitos dictados, en orden de prioridad: la pieza ausente manda
 * sobre todo lo demás (no lleva procedimiento ni precio).
 */
const STATUS_KEYWORDS: { status: OdontogramItemStatus; words: string[] }[] = [
  {
    status: 'absent',
    words: [
      'ausente',
      'ausentes',
      'extraida',
      'extraidas',
      'extraido',
      'extraidos',
      'perdida',
      'perdido',
      'faltante',
      'falta',
    ],
  },
  {
    status: 'completed',
    words: [
      'realizado',
      'realizada',
      'realizados',
      'realizadas',
      'hecho',
      'hecha',
      'terminado',
      'terminada',
      'concluido',
      'concluida',
      'obturado',
      'obturada',
      'colocado',
      'colocada',
    ],
  },
  {
    status: 'budgeted',
    words: [
      'presupuestado',
      'presupuestada',
      'presupuesto',
      'presupuestar',
      'planificado',
      'planificada',
      'previsto',
      'prevista',
    ],
  },
  { status: 'pending', words: ['pendiente', 'pendientes', 'patologia'] },
]

/**
 * Hallazgos: si el doctor dicta una patología sin decir el estado, la pieza
 * queda en rojo («pendiente») hasta que se trate.
 */
const PATHOLOGY_WORDS = [
  'caries',
  'cariada',
  'cariado',
  'fractura',
  'fracturada',
  'fracturado',
  'lesion',
  'lesiones',
  'mancha',
  'desgaste',
  'movilidad',
  'absceso',
  'fistula',
  'sarro',
  'calculo',
  'gingivitis',
  'sensibilidad',
  'dolor',
]

/** `true` cuando el dictado dice que la pieza no está («no presenta»). */
const MISSING_TOOTH_PHRASE = /\bno (?:esta|presenta|tiene)\b/

type StatusHit = {
  status: OdontogramItemStatus
  index: number
  /**
   * `explicit` = palabra de estado (`presupuestado`), `pathology` = hallazgo
   * (`caries`, que además es el nombre del procedimiento) y `phrase` = la frase
   * «no presenta» (sin palabra suelta que descartar).
   */
  source: 'explicit' | 'pathology' | 'phrase'
}

function extractStatus(tokens: string[], text: string): StatusHit | null {
  if (MISSING_TOOTH_PHRASE.test(text)) return { status: 'absent', index: 0, source: 'phrase' }

  for (const group of STATUS_KEYWORDS) {
    for (const word of group.words) {
      const index = tokens.indexOf(word)

      if (index >= 0) return { status: group.status, index, source: 'explicit' }
    }
  }

  for (const word of PATHOLOGY_WORDS) {
    const index = tokens.indexOf(word)

    if (index >= 0) return { status: 'pending', index, source: 'pathology' }
  }

  return null
}

/** Palabras que no forman parte del nombre del procedimiento. */
const NAME_STOPWORDS = new Set([
  'en',
  'la',
  'el',
  'los',
  'las',
  'del',
  'de',
  'con',
  'y',
  'o',
  'para',
  'por',
  'que',
  'se',
  'le',
  'un',
  'una',
  'cara',
  'superficie',
  'pieza',
  'piezas',
  'diente',
  'dientes',
  'numero',
  'num',
  'n',
  'dental',
  'pone',
  'poner',
  'ponemos',
  'agrega',
  'agregar',
  'agregamos',
  'carga',
  'cargar',
  'cargamos',
  'registra',
  'registrar',
  'marca',
  'marcar',
  'anota',
  'anotar',
  'hace',
  'hacer',
  'hacemos',
  'esta',
  'estan',
  'presenta',
  'tiene',
  'tambien',
  'entonces',
  'bueno',
  'ok',
])

/**
 * Nombre del hallazgo o procedimiento: se descartan la pieza, la cara, el
 * estado explícito y las muletillas del dictado. «Pieza 16 oclusal caries» →
 * `caries` (el hallazgo se conserva: es lo que identifica el procedimiento).
 */
function extractTreatmentName(
  tokens: string[],
  tooth: { end: number },
  surface: { index: number } | null,
  status: StatusHit | null,
): string {
  const consumed = new Set<number>()

  for (let index = 0; index < tooth.end; index += 1) consumed.add(index)
  if (surface) consumed.add(surface.index)
  if (status?.source === 'explicit') consumed.add(status.index)

  return tokens
    .filter((token, index) => !consumed.has(index) && !NAME_STOPWORDS.has(token))
    .join(' ')
}


/**
 * Sinónimos clínicos: lo que el doctor dice → lo que suele llamarse en el
 * catálogo. Se usan como variantes extra (nunca reemplazan el texto dictado).
 */
const TREATMENT_SYNONYMS: Record<string, string[]> = {
  resina: ['resina', 'obturacion', 'restauracion'],
  obturacion: ['obturacion', 'resina'],
  restauracion: ['restauracion', 'obturacion', 'resina'],
  caries: ['obturacion', 'resina'],
  amalgama: ['amalgama', 'obturacion'],
  fluor: ['fluor', 'topicacion'],
  topicacion: ['topicacion', 'fluor'],
  limpieza: ['limpieza', 'profilaxis', 'destartraje'],
  profilaxis: ['profilaxis', 'limpieza', 'destartraje'],
  sarro: ['destartraje', 'limpieza'],
  destartraje: ['destartraje', 'limpieza'],
  conducto: ['conducto', 'endodoncia'],
  endodoncia: ['endodoncia', 'conducto'],
  extraccion: ['extraccion', 'exodoncia'],
  exodoncia: ['exodoncia', 'extraccion'],
  sacar: ['extraccion', 'exodoncia'],
  sellante: ['sellante', 'sellado'],
  sellado: ['sellado', 'sellante'],
  corona: ['corona'],
  brackets: ['brackets', 'ortodoncia'],
  ortodoncia: ['ortodoncia', 'brackets'],
  implante: ['implante'],
  protesis: ['protesis'],
  blanqueamiento: ['blanqueamiento'],
  pulido: ['pulido'],
  control: ['control'],
  ajuste: ['ajuste'],
  radiografia: ['radiografia'],
}

/** Puntaje mínimo para aceptar una coincidencia del catálogo. */
const MATCH_THRESHOLD = 65

/** Variantes a probar: el texto dictado y sus sinónimos clínicos. */
function buildVariants(name: string): string[] {
  const normalized = normalizeSpeech(name)

  if (!normalized) return []

  const variants = new Set<string>([normalized])

  for (const token of normalized.split(' ')) {
    for (const synonym of TREATMENT_SYNONYMS[token] ?? []) variants.add(synonym)
  }

  return [...variants]
}

/** Puntaje 0-100 de una variante contra un procedimiento del catálogo. */
function scoreName(variant: string, option: TreatmentOption): number {
  const candidate = normalizeSpeech(variant)

  if (!candidate) return 0

  const name = normalizeSpeech(option.name)
  const code = normalizeSpeech(option.code)

  if (name === candidate || code === candidate) return 100

  const candidateTokens = candidate.split(' ')
  const nameTokens = name.split(' ')

  if (candidateTokens.every((token) => nameTokens.includes(token))) return 90
  if (name.startsWith(candidate)) return 80
  if (name.includes(candidate)) return 75
  if (candidate.includes(name)) return 70

  const hits = candidateTokens.filter((token) => nameTokens.includes(token)).length

  return Math.round((60 * hits) / candidateTokens.length)
}

/** Mejor puntaje entre todas las variantes (+5 por cada variante extra acertada). */
function scoreTreatment(variants: string[], option: TreatmentOption): number {
  const scores = variants.map((variant) => scoreName(variant, option)).filter((score) => score > 0)

  if (scores.length === 0) return 0

  return Math.min(100, Math.max(...scores) + 5 * (scores.length - 1))
}

export type TreatmentMatch = {
  /** Procedimiento elegido (`null` si no hay coincidencia única). */
  treatment: TreatmentOption | null
  /** Coincidencias empatadas: el doctor tiene que elegir cuál es. */
  alternatives: TreatmentOption[]
}

/**
 * Busca el procedimiento del catálogo que corresponde al nombre dictado.
 *
 * Si dos procedimientos empatan (por ejemplo «caries» con «Obturación con
 * resina» y «Obturación con amalgama») no se elige uno al azar: se devuelven
 * las alternativas para que la barra abra el modal de la pieza.
 */
export function findTreatmentMatch(name: string, treatments: TreatmentOption[]): TreatmentMatch {
  const variants = buildVariants(name)

  if (variants.length === 0) return { treatment: null, alternatives: [] }

  const scored = treatments
    .map((option) => ({ option, score: scoreTreatment(variants, option) }))
    .filter((entry) => entry.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0) return { treatment: null, alternatives: [] }

  const best = scored[0].score
  const winners = scored.filter((entry) => entry.score === best).map((entry) => entry.option)

  return winners.length === 1
    ? { treatment: winners[0], alternatives: [] }
    : { treatment: null, alternatives: winners }
}


// --- Interpretación del comando ------------------------------------------------

/**
 * Parser rápido, sin red: pieza + cara + estado + nombre del procedimiento.
 * Devuelve `null` si no se puede leer la pieza (ahí entra Gemini).
 */
export function parseOdontogramCommand(
  text: string,
  treatments: TreatmentOption[],
): OdontogramVoiceCommand | null {
  const normalized = normalizeSpeech(text)

  if (!normalized) return null

  const tokens = normalized.split(' ')
  const tooth = parseTooth(tokens)

  if (!tooth) return null

  const surface = extractSurface(tokens)
  const status = extractStatus(tokens, normalized)
  const itemStatus = status?.status ?? 'budgeted'
  const name = extractTreatmentName(tokens, tooth, surface, status)
  const match = findTreatmentMatch(name, treatments)

  return {
    raw: text.trim(),
    toothNumber: tooth.toothNumber,
    // La pieza ausente se guarda como pieza completa, sin cara.
    surface: itemStatus === 'absent' ? null : (surface?.surface ?? null),
    status: itemStatus,
    name,
    treatment: itemStatus === 'absent' ? null : match.treatment,
    source: 'regex',
  }
}

const ODONTOGRAM_SYSTEM_INSTRUCTION = [
  'Eres un asistente odontológico de AD Clinic (Asunción, Paraguay).',
  'Recibís un comando dictado por un odontólogo sobre una pieza dental y lo convertís en un registro del odontograma.',
  '',
  'Reglas:',
  '1. Devolvés únicamente el JSON del esquema. Sin explicaciones ni markdown.',
  '2. tooth_number va en notación FDI, sin puntos ni espacios: "16", "46", "75".',
  '3. surface es la cara dictada; "none" si el comando no nombra una cara o si la pieza está ausente.',
  '4. status: "missing" si la pieza falta o fue extraída; "pending" si dicta una patología (caries, fractura, dolor) sin decir que se presupuestó o se realizó; "completed" si dice que ya se hizo; "budgeted" en cualquier otro caso (plan o presupuesto).',
  '5. condition_or_treatment_name es el procedimiento del catálogo que mejor corresponda: copiá el nombre EXACTO del catálogo cuando exista. Si no hay nada parecido, transcribí lo dictado. No inventes procedimientos.',
  '6. No agregues datos clínicos que el dictado no mencione.',
].join('\n')

/**
 * Esquema de salida (subconjunto OpenAPI de Gemini).
 * `surface` usa `"none"` en lugar de `null` porque el esquema REST no describe
 * campos anulables; se traduce al normalizar la respuesta.
 */
const ODONTOGRAM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    tooth_number: {
      type: 'INTEGER',
      description: 'Pieza en notación FDI: 11-48 (permanente) o 51-85 (temporal).',
    },
    surface: {
      type: 'STRING',
      enum: ['occlusal', 'vestibular', 'lingual', 'mesial', 'distal', 'none'],
      description: 'Cara dictada; "none" si no se menciona o la pieza está ausente.',
    },
    condition_or_treatment_name: {
      type: 'STRING',
      description: 'Procedimiento del catálogo (nombre exacto) o el texto dictado.',
    },
    status: {
      type: 'STRING',
      enum: GEMINI_STATUS_VALUES,
      description: 'Estado clínico del registro.',
    },
  },
  required: ['tooth_number', 'surface', 'condition_or_treatment_name', 'status'],
}

/** Tope de procedimientos que se listan en el prompt (el catálogo es corto). */
const MAX_CATALOG_PROMPT = 80

/** Tope de texto dictado que se envía a Gemini. */
const MAX_COMMAND_CHARS = 400

function buildCatalogPrompt(treatments: TreatmentOption[]): string {
  if (treatments.length === 0) return 'El catálogo no tiene procedimientos cargados.'

  return treatments
    .slice(0, MAX_CATALOG_PROMPT)
    .map((option) => `- ${option.code} · ${option.name} (${option.category})`)
    .join('\n')
}

const VOICE_STATUS_MAP: Record<string, OdontogramItemStatus> = {
  missing: 'absent',
  absent: 'absent',
  pending: 'pending',
  budgeted: 'budgeted',
  completed: 'completed',
}

const VOICE_SURFACE_MAP: Record<string, ToothSurface | null> = {
  occlusal: 'occlusal',
  vestibular: 'vestibular',
  lingual: 'lingual',
  mesial: 'mesial',
  distal: 'distal',
  none: null,
}

/** Pieza FDI 11-48 / 51-85 como número (`null` si el modelo devolvió otra cosa). */
function asToothNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)

  if (!Number.isFinite(parsed)) return null

  const tooth = Math.trunc(parsed)
  const quadrant = Math.trunc(tooth / 10)
  const position = tooth % 10

  if (quadrant < 1 || quadrant > 8 || position < 1 || position > 8) return null

  return tooth
}

function asVoiceStatus(value: unknown, text: string): OdontogramItemStatus {
  const key = typeof value === 'string' ? value.trim().toLocaleLowerCase('es') : ''
  const mapped = VOICE_STATUS_MAP[key]

  if (mapped) return mapped

  // Si el modelo devolvió un estado raro, se vuelve al parser rápido.
  return extractStatus(text.split(' '), text)?.status ?? 'budgeted'
}

function asVoiceSurface(value: unknown): ToothSurface | null {
  const key = typeof value === 'string' ? value.trim().toLocaleLowerCase('es') : ''

  return key in VOICE_SURFACE_MAP ? VOICE_SURFACE_MAP[key] : null
}


/** JSON de Gemini → comando con tipos garantizados. */
function normalizeGeminiCommand(
  value: unknown,
  raw: string,
  treatments: TreatmentOption[],
): OdontogramVoiceCommand | null {
  const candidate = (value ?? {}) as Record<string, unknown>
  const toothNumber = asToothNumber(candidate.tooth_number)

  if (toothNumber === null) return null

  const text = normalizeSpeech(raw)
  const status = asVoiceStatus(candidate.status, text)
  const name =
    typeof candidate.condition_or_treatment_name === 'string'
      ? normalizeSpeech(candidate.condition_or_treatment_name)
      : ''
  const match = findTreatmentMatch(name, treatments)

  return {
    raw: raw.trim(),
    toothNumber,
    surface: status === 'absent' ? null : asVoiceSurface(candidate.surface),
    status,
    name: name || 'procedimiento',
    treatment: status === 'absent' ? null : match.treatment,
    source: 'gemini',
  }
}

/**
 * Interpreta el comando con Gemini Flash (frases libres, sinónimos, piezas
 * dictadas de forma rara). Recibe el catálogo para devolver un nombre que
 * exista en la clínica. Lanza `GeminiError` si la llamada falla.
 */
export async function parseOdontogramCommandWithGemini(
  text: string,
  treatments: TreatmentOption[],
): Promise<OdontogramVoiceCommand | null> {
  const command = text.trim().slice(0, MAX_COMMAND_CHARS)

  if (!command) return null

  const parsed = await requestGeminiJson({
    systemInstruction: ODONTOGRAM_SYSTEM_INSTRUCTION,
    prompt: `Comando dictado:\n"""\n${command}\n"""\n\nCatálogo de procedimientos:\n${buildCatalogPrompt(treatments)}`,
    schema: ODONTOGRAM_SCHEMA,
    maxOutputTokens: 512,
  })

  return normalizeGeminiCommand(parsed, text, treatments)
}

/** `true` cuando el comando ya se puede guardar sin ayuda del doctor. */
function isActionable(command: OdontogramVoiceCommand): boolean {
  return command.status === 'absent' || command.treatment !== null
}

/**
 * Comprueba que la pieza exista en la dentición abierta y que el procedimiento
 * tenga precio de catálogo (la caja no registra importes en cero).
 */
function finalizeCommand(
  command: OdontogramVoiceCommand,
  dentition: Dentition,
): OdontogramVoiceResult {
  const selection: ToothSelection = {
    toothNumber: command.toothNumber,
    surface: command.surface,
  }

  if (!isValidTooth(command.toothNumber, dentition)) {
    const other: Dentition = dentition === 'permanent' ? 'temporary' : 'permanent'

    return {
      command: null,
      message: isValidTooth(command.toothNumber, other)
        ? `La pieza ${command.toothNumber} es de la dentición ${other === 'temporary' ? 'temporal' : 'permanente'}. Cambiá el conmutador y volvé a dictar.`
        : `La pieza ${command.toothNumber} no existe en notación FDI (11-48 o 51-85).`,
      pendingSelection: null,
    }
  }

  if (command.status === 'absent') {
    return { command, message: null, pendingSelection: null }
  }

  if (!command.treatment) {
    return {
      command: null,
      message: `No pude identificar el procedimiento de la pieza ${command.toothNumber}. Elegilo en la ficha de la pieza.`,
      pendingSelection: selection,
    }
  }

  if (command.treatment.default_price <= 0) {
    return {
      command: null,
      message: `El procedimiento «${command.treatment.name}» no tiene precio en el catálogo. Cargalo desde la ficha de la pieza.`,
      pendingSelection: selection,
    }
  }

  return { command, message: null, pendingSelection: null }
}


/**
 * Interpreta un comando dictado: primero el parser rápido y, si no alcanza,
 * Gemini. No lanza por errores de Gemini (se muestran como `message`).
 */
export async function interpretVoiceCommand(
  text: string,
  context: { treatments: TreatmentOption[]; dentition: Dentition },
): Promise<OdontogramVoiceResult> {
  const local = parseOdontogramCommand(text, context.treatments)

  if (local && isActionable(local)) return finalizeCommand(local, context.dentition)

  let aiMessage: string | null = null

  if (isGeminiConfigured()) {
    try {
      const remote = await parseOdontogramCommandWithGemini(text, context.treatments)

      if (remote && isActionable(remote)) return finalizeCommand(remote, context.dentition)

      if (remote) aiMessage = `Gemini tampoco encontró «${remote.name}» en el catálogo.`
    } catch (error) {
      aiMessage =
        error instanceof GeminiError ? error.message : 'No se pudo interpretar el dictado con IA.'
    }
  }

  if (!local) {
    return {
      command: null,
      message:
        aiMessage ??
        'No pude leer la pieza dictada. Probá con «pieza 16 oclusal caries» o «pieza 21 ausente».',
      pendingSelection: null,
    }
  }

  const alternatives = findTreatmentMatch(local.name, context.treatments).alternatives
  const reason =
    alternatives.length > 1
      ? `«${local.name}» coincide con ${alternatives.length} procedimientos (${alternatives
          .slice(0, 3)
          .map((option) => option.name)
          .join(', ')}).`
      : local.name
        ? `No encontré «${local.name}» en el catálogo de tratamientos.`
        : 'El comando no incluye el procedimiento: decí, por ejemplo, «pieza 16 oclusal resina».'

  return {
    command: null,
    message: aiMessage ? `${reason} ${aiMessage}` : `${reason} Elegilo en la ficha de la pieza.`,
    pendingSelection: { toothNumber: local.toothNumber, surface: local.surface },
  }
}

/**
 * Comando → datos del modal de la pieza (`saveItem`). El precio se copia del
 * catálogo y queda congelado en el presupuesto, igual que al elegirlo a mano.
 */
export function toOdontogramDraft(command: OdontogramVoiceCommand): OdontogramDraft {
  if (command.status === 'absent') {
    return {
      toothNumber: command.toothNumber,
      surface: null,
      status: 'absent',
      treatmentId: null,
      quantity: 1,
      unitPrice: 0,
      notes: null,
    }
  }

  if (!command.treatment) {
    throw new Error('Elegí el procedimiento del catálogo antes de guardar.')
  }

  return {
    toothNumber: command.toothNumber,
    surface: command.surface,
    status: command.status,
    treatmentId: command.treatment.id,
    quantity: 1,
    unitPrice: command.treatment.default_price,
    notes: null,
  }
}

/**
 * Texto del aviso al aplicar: `Pieza 16 (Oclusal) → Obturación con resina ·
 * Pendiente`. La pieza ausente se anuncia sola (`Pieza 21 → Ausente`).
 */
export function describeVoiceCommand(command: OdontogramVoiceCommand): string {
  const where = command.surface
    ? `Pieza ${command.toothNumber} (${getSurfaceLabel(command.surface)})`
    : `Pieza ${command.toothNumber}`

  if (command.status === 'absent') return `${where} → ${ITEM_STATUS_META.absent.label}`

  const treatment = command.treatment?.name ?? command.name

  return `${where} → ${treatment} · ${ITEM_STATUS_META[command.status].label}`
}

