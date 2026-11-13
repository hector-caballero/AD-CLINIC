import type { InvoicingTimbrado, TaxIssuerKind, TimbradoMode } from './invoicing-types'

/**
 * Formato de números fiscales paraguayos.
 *
 * - Número de factura: `000-000-0000000`
 *   - establecimiento: 3 dígitos (`001`)
 *   - punto de expedición: 3 dígitos (`001`)
 *   - correlativo: 7 dígitos con relleno de ceros
 * - Timbrado: 8 dígitos (`12345678`).
 * - CDC (SIFEN): 44 dígitos.
 *
 * La máscara del input es progresiva (separa mientras se escribe) y el relleno
 * de ceros se aplica al armar el número definitivo (`buildInvoiceNumber`).
 */

/** Número de factura completo, tal como lo valida la base. */
export const INVOICE_NUMBER_PATTERN = /^\d{3}-\d{3}-\d{7}$/

/** Correlativo máximo admitido (7 dígitos). */
export const INVOICE_SEQUENCE_MAX = 9_999_999

/** Longitud total del número sin guiones. */
export const INVOICE_NUMBER_DIGITS = 13

function onlyDigits(value: string): string {
  return value.replace(/\D+/g, '')
}

/** `7` → `0000007`. */
export function padSequence(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0

  return String(safe).padStart(7, '0')
}

/** `1` → `001`. */
export function padGroup(value: string | number): string {
  return onlyDigits(String(value)).padStart(3, '0').slice(0, 3)
}

/**
 * Máscara progresiva del número de factura: `1234567890` → `123-456-7890`.
 * No rellena ceros mientras se escribe para no pelear con el cursor; el
 * relleno se hace al enviar (`buildInvoiceNumber`).
 */
export function formatInvoiceNumberInput(value: string): string {
  const digits = onlyDigits(value).slice(0, INVOICE_NUMBER_DIGITS)

  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`

  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
}

export type InvoiceNumberParts = {
  establishment: string
  emissionPoint: string
  sequence: number
  /** `true` cuando se cargaron los 13 dígitos. */
  isComplete: boolean
}

/** Descompone lo escrito en el input (con o sin guiones). */
export function parseInvoiceNumberInput(value: string): InvoiceNumberParts {
  const digits = onlyDigits(value).slice(0, INVOICE_NUMBER_DIGITS)

  return {
    establishment: digits.slice(0, 3),
    emissionPoint: digits.slice(3, 6),
    sequence: digits.length > 6 ? Number(digits.slice(6)) : 0,
    isComplete: digits.length === INVOICE_NUMBER_DIGITS,
  }
}

/** Número completo con relleno: `('1', '1', 7)` → `001-001-0000007`. */
export function buildInvoiceNumber(
  establishment: string,
  emissionPoint: string,
  sequence: number,
): string {
  return `${padGroup(establishment)}-${padGroup(emissionPoint)}-${padSequence(sequence)}`
}

/** Solo dígitos del timbrado, máximo 8. */
export function formatTimbradoInput(value: string): string {
  return onlyDigits(value).slice(0, 8)
}

/** Establecimiento / punto de expedición: 3 dígitos. */
export function formatGroupInput(value: string): string {
  return onlyDigits(value).slice(0, 3)
}

/** Base del RUC: las personas físicas usan 6–7 dígitos y las empresas 8. */
export const RUC_BASE_MIN = 5
export const RUC_BASE_MAX = 8

/** Máximo de dígitos del campo RUC (base + dígito verificador). */
export const RUC_INPUT_MAX_DIGITS = RUC_BASE_MAX + 1

/**
 * RUC completo tal como lo exige la DNIT: base de 5 a 8 dígitos, guion y dígito
 * verificador (`3870633-4`, `80012345-6`).
 */
export const RUC_PATTERN = /^[0-9]{5,8}-[0-9]$/

/** Ayuda contextual con los dos tamaños habituales. */
export const RUC_FORMAT_HINT = 'Persona física: 3870633-4 · Empresa: 80012345-6'

/** Solo dígitos del RUC, sin guion, con el tope de 9 posiciones. */
export function normalizeRucDigits(value: string): string {
  return onlyDigits(value).slice(0, RUC_INPUT_MAX_DIGITS)
}

/**
 * Máscara del campo RUC: deja escribir dígitos y **un** guion separador.
 *
 * - Sin guion se respetan los dígitos tal cual, hasta el tope de 9. Al llegar al
 *   noveno (base 8 + DV) el guion se inserta solo, porque ahí ya no hay dudas.
 * - Con guion, la base queda limitada a 8 dígitos y el verificador a 1.
 *
 * No fuerza el guion con 6–8 dígitos mientras se escribe: la persona física
 * puede seguir tipeando y el formato se resuelve en `autoFormatRuc` (al salir
 * del campo o antes de consultar la DNIT).
 */
export function formatRucInput(value: string): string {
  // Un guion al inicio no aporta (el campo arranca con la base): se descarta.
  const cleaned = value.replace(/[^0-9-]/g, '').replace(/^-+/, '')
  const hyphenIndex = cleaned.indexOf('-')

  if (hyphenIndex === -1) {
    const digits = cleaned.slice(0, RUC_INPUT_MAX_DIGITS)

    if (digits.length <= RUC_BASE_MAX) return digits

    return `${digits.slice(0, RUC_BASE_MAX)}-${digits.slice(RUC_BASE_MAX)}`
  }

  const base = onlyDigits(cleaned.slice(0, hyphenIndex)).slice(0, RUC_BASE_MAX)
  const dv = onlyDigits(cleaned.slice(hyphenIndex + 1)).slice(0, 1)

  return dv ? `${base}-${dv}` : `${base}-`
}

/**
 * Agrega el guion al salir del campo o al consultar la DNIT.
 *
 * Si el usuario escribió solo dígitos (`38706334`) se asume que el último es el
 * verificador. Con menos de 6 dígitos se devuelve tal cual: todavía no hay DV.
 */
export function autoFormatRuc(value: string): string {
  const trimmed = value.trim()

  if (!trimmed) return ''
  if (trimmed.includes('-')) return formatRucInput(trimmed)

  const digits = onlyDigits(trimmed)

  if (digits.length < RUC_BASE_MIN + 1) return digits

  return `${digits.slice(0, -1)}-${digits.slice(-1)}`
}

export type RucParts = {
  base: string
  dv: string
  /** `true` cuando `base` + `dv` cumplen `RUC_PATTERN`. */
  isComplete: boolean
}

/** Descompone lo escrito en base y dígito verificador (con o sin guion). */
export function splitRuc(value: string): RucParts {
  const trimmed = value.trim()

  if (trimmed.includes('-')) {
    const [rawBase, ...rest] = trimmed.split('-')
    const base = onlyDigits(rawBase)
    const dv = onlyDigits(rest.join('')).slice(0, 1)

    return { base, dv, isComplete: RUC_PATTERN.test(trimmed) }
  }

  const digits = onlyDigits(trimmed)

  if (digits.length < RUC_BASE_MIN + 1) return { base: digits, dv: '', isComplete: false }

  const base = digits.slice(0, -1)
  const dv = digits.slice(-1)

  return { base, dv, isComplete: RUC_PATTERN.test(`${base}-${dv}`) }
}

/** `true` si el RUC tiene base de 5 a 8 dígitos y verificador. */
export function isValidRuc(value: string): boolean {
  return RUC_PATTERN.test(value.trim())
}

/** Fecha local `YYYY-MM-DD` (sin desfase de zona horaria). */
export function getTodayKey(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Correlativo que sigue según la modalidad (espejo de
 * `public.next_timbrado_sequence`):
 * - preimpreso: cae desde `range_to`;
 * - resto: asciende desde `range_from`;
 * - `last_number = 0` significa que todavía no se emitió nada.
 *
 * Devuelve `null` cuando el rango se agotó.
 */
export function getNextSequenceNumber(
  timbrado: Pick<
    InvoicingTimbrado,
    'mode' | 'range_from' | 'range_to' | 'last_number'
  >,
): number | null {
  let next: number

  if (timbrado.last_number === 0) {
    next = timbrado.mode === 'preprinted' ? timbrado.range_to : timbrado.range_from
  } else if (timbrado.mode === 'preprinted') {
    next = timbrado.last_number - 1
  } else {
    next = timbrado.last_number + 1
  }

  if (next < timbrado.range_from || next > timbrado.range_to) return null

  return next
}

/** Número que se muestra en el campo para la modalidad del timbrado. */
export function buildTimbradoNumberPreview(
  timbrado: Pick<
    InvoicingTimbrado,
    'mode' | 'range_from' | 'range_to' | 'last_number' | 'establishment' | 'emission_point'
  >,
): string | null {
  const sequence = getNextSequenceNumber(timbrado)

  if (sequence === null) return null

  return buildInvoiceNumber(timbrado.establishment, timbrado.emission_point, sequence)
}


export type CdcSeed = {
  /** RUC del emisor con dígito verificador (`80012345-6`). */
  ruc: string
  establishment: string
  emissionPoint: string
  sequence: number
  /** Fecha de emisión `YYYY-MM-DD`. */
  issuedOn: string
  taxpayerKind: TaxIssuerKind
  /** Número de timbrado usado como semilla del código de seguridad. */
  timbradoNumber: string
}

/**
 * Vista previa del CDC (Código de Control) de 44 dígitos.
 *
 * Respeta el orden de campos del SIFEN: tipo de documento (2), RUC (8), DV (1),
 * establecimiento (3), punto (3), correlativo (7), tipo de contribuyente (1),
 * fecha (8), tipo de emisión (1), código de seguridad (9) y dígito verificador
 * módulo 11 (1).
 *
 * IMPORTANTE: es solo una referencia para operar mientras no haya integración
 * con el SIFEN. El CDC real lo emite la SET tras firmar el XML; el código de
 * seguridad de 9 dígitos es aquí un marcador derivado del timbrado.
 */
export function buildCdcPreview(seed: CdcSeed): string {
  const rucDigits = onlyDigits(seed.ruc)
  const rucBase = rucDigits.slice(0, 8).padStart(8, '0')
  const dv = rucDigits.slice(8, 9) || '0'
  const issued = onlyDigits(seed.issuedOn).padEnd(8, '0').slice(0, 8)
  const security = onlyDigits(seed.timbradoNumber).padStart(9, '0').slice(0, 9)

  const body = [
    '01', // factura electrónica
    rucBase,
    dv,
    padGroup(seed.establishment),
    padGroup(seed.emissionPoint),
    padSequence(seed.sequence),
    seed.taxpayerKind === 'company' ? '2' : '1',
    issued,
    '1', // emisión normal
    security,
  ].join('')

  return `${body}${cdcCheckDigit(body)}`
}

/** Dígito verificador módulo 11 con pesos 2..11 de derecha a izquierda. */
function cdcCheckDigit(digits: string): string {
  let sum = 0
  let weight = 2

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    sum += Number(digits[index]) * weight
    weight = weight === 11 ? 2 : weight + 1
  }

  const check = (11 - (sum % 11)) % 11

  return String(check === 10 ? 0 : check)
}

/** Etiqueta corta de la modalidad para ayudas contextuales. */
export const TIMBRADO_MODE_BADGE: Record<TimbradoMode, string> = {
  manual: 'Manual',
  preprinted: 'Preimpreso',
  autoimpresor: 'Autoimpresor',
  electronic: 'Electrónica',
}
