/**
 * Utilidades de formato compartidas por la interfaz.
 *
 * Convenciones de Paraguay:
 * - Moneda: guaraní (PYG), sin decimales y con punto como separador de miles.
 * - Documentos: C.I. `1.234.567` (solo dígitos, sin DV), RUC `3870633-4`
 *   (base de 5 a 8 dígitos + dígito verificador), pasaporte alfanumérico.
 * - Teléfonos: móvil `0981 123 456`, fijo `021 123 456`, internacional `+595 ...`.
 *
 * El RUC es la única fuente de la máscara fiscal paraguaya: la usan la ficha de
 * pacientes y todo el módulo de facturación (`invoicing-format.ts` reexporta
 * estas funciones para conservar los nombres históricos).
 */

/** Tipo de documento admitido por la ficha de pacientes. */
export type ParaguayDocumentType = 'CI' | 'RUC' | 'Pasaporte'

const PYG_SYMBOL = '₲'

/**
 * `Intl` con locale `es-PY` aplica el separador de miles con punto y ningún
 * decimal, que es la convención del guaraní.
 */
const PYG_NUMBER = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 })

/** Agrupa dígitos con punto como separador de miles (`1234567` → `1.234.567`). */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function onlyDigits(value: string): string {
  return value.replace(/\D+/g, '')
}

/**
 * Monto en guaraníes. La moneda no tiene centavos: se redondea y se agrupa con
 * puntos. `formatPYG(150000)` → `₲ 150.000`.
 */
export function formatPYG(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0
  const absolute = PYG_NUMBER.format(Math.abs(safe))

  return safe < 0 ? `-${PYG_SYMBOL} ${absolute}` : `${PYG_SYMBOL} ${absolute}`
}

/**
 * Monto para un `<input>` en guaraníes: descarta lo que no sea dígito y agrupa
 * los miles mientras se escribe (`1500000` → `1.500.000`). No incluye el
 * símbolo `₲`, que se muestra como prefijo del campo.
 *
 * Se cortan los ceros a la izquierda y se limita a 10 dígitos porque
 * `numeric(12, 2)` admite 10 enteros.
 */
export function formatPYGInput(value: string): string {
  const digits = onlyDigits(value).replace(/^0+(?=\d)/, '').slice(0, 10)

  return groupThousands(digits)
}

/** `1.500.000` → `1500000` (0 si el campo está vacío o no tiene dígitos). */
export function parsePYGInput(value: string): number {
  const digits = onlyDigits(value)

  if (!digits) return 0

  const amount = Number(digits)

  return Number.isFinite(amount) ? amount : 0
}

/** `1.234.567` — Cédula de Identidad paraguaya (solo dígitos, máximo 8, sin DV). */
export function formatCI(value: string): string {
  return groupThousands(onlyDigits(value).slice(0, 8))
}

// -----------------------------------------------------------------------------
// RUC (Registro Único del Contribuyente)
// -----------------------------------------------------------------------------

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

/** Formatea el documento mientras se escribe, según el tipo elegido. */
export function formatDocumentNumber(value: string, type: ParaguayDocumentType): string {
  if (type === 'CI') return formatCI(value)
  if (type === 'RUC') return formatRucInput(value)

  return value
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 12)
}

/** Valor limpio para guardar y buscar: sin puntos, guiones ni espacios. */
export function normalizeDocumentNumber(
  value: string | null | undefined,
  type: ParaguayDocumentType,
): string {
  const source = value ?? ''

  if (type === 'Pasaporte') return source.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()

  // La C.I. no lleva dígito verificador: si alguien escribe `4512789-0` se
  // descarta lo que sigue al guion.
  const [base] = type === 'CI' ? source.split('-') : [source]

  return onlyDigits(base)
}

/** Normaliza el valor guardado en `patients.document_type` (tolera datos viejos). */
export function resolveDocumentType(value: string | null | undefined): ParaguayDocumentType {
  if (value === 'RUC' || value === 'Pasaporte') return value

  return 'CI'
}

/**
 * Validación estructural (no calcula el dígito verificador del RUC).
 *
 * - C.I.: 5 a 8 dígitos, sin dígito verificador.
 * - RUC: base de 5 a 8 dígitos + verificador (`3870633-4`). Se acepta lo
 *   escrito sin guion porque el formato se resuelve al salir del campo.
 * - Pasaporte: 6 a 12 letras o números.
 */
export function isValidDocumentNumber(value: string, type: ParaguayDocumentType): boolean {
  const normalized = normalizeDocumentNumber(value, type)

  if (!normalized) return false
  if (type === 'CI') return /^\d{5,8}$/.test(normalized)
  if (type === 'RUC') return isValidRuc(autoFormatRuc(normalized))

  return /^[A-Z0-9]{6,12}$/.test(normalized)
}

/** Etiqueta corta del documento: `C.I. 1.234.567`, `RUC 3870633-4`. */
export function formatPatientDocument(
  documentType: string | null | undefined,
  documentNumber: string | null | undefined,
): string {
  const type = resolveDocumentType(documentType)
  const raw = documentNumber?.trim()

  if (!raw) return '—'

  const labels: Record<ParaguayDocumentType, string> = {
    CI: 'C.I.',
    RUC: 'RUC',
    Pasaporte: 'Pasaporte',
  }

  const formatted =
    type === 'RUC'
      ? autoFormatRuc(raw)
      : formatDocumentNumber(normalizeDocumentNumber(raw, type), type)

  return `${labels[type]} ${formatted}`
}

/** Teléfono paraguayo con máscara visual (`0981 123 456`). */
export function formatPhonePY(value: string): string {
  const digits = onlyDigits(value)

  if (!digits) return ''

  if (digits.startsWith('595')) {
    const local = digits.slice(3, 12)
    const parts = [local.slice(0, 3), local.slice(3, 6), local.slice(6, 9)].filter(Boolean)

    return ['+595', ...parts].join(' ')
  }

  const local = digits.slice(0, 10)
  // Los móviles usan prefijo de 4 dígitos (09xx); las líneas fijas, de 3 (021).
  const prefixLength = local.startsWith('09') ? 4 : 3
  const parts = [local.slice(0, prefixLength)]

  for (let index = prefixLength; index < local.length; index += 3) {
    parts.push(local.slice(index, index + 3))
  }

  return parts.join(' ')
}

/** Teléfono listo para guardar: solo dígitos (`0981 123 456` → `0981123456`). */
export function normalizePhone(value: string): string {
  return onlyDigits(value)
}

/** `2026-10-28` → `28/10/2026`. Se parsea como texto para evitar desfases de zona horaria. */
export function formatShortDate(value: string | null | undefined): string {
  if (!value) return '—'

  const [year, month, day] = value.slice(0, 10).split('-')

  if (!year || !month || !day) return '—'

  return `${day}/${month}/${year}`
}

/**
 * Iniciales para avatares. Acepta un email (`ana.lopez@adclinic.com` → `AL`)
 * o un nombre completo (`Ana López` → `AL`).
 */
export function getInitials(value: string | null | undefined): string {
  const source = value?.trim() ?? ''
  const [localPart = ''] = source.split('@')
  const words = localPart.split(/[._\-+\s]+/).filter(Boolean)
  const [first, second] = words

  if (!first) return 'AD'

  const letters = second ? [first[0], second[0]] : [...first].slice(0, 2)
  return letters.join('').toUpperCase()
}

/** `miércoles, 28 de octubre` */
export function formatLongDate(date: Date): string {
  const formatted = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date)

  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

/** Saludo según la hora del día. */
export function getGreeting(date: Date): string {
  const hour = date.getHours()

  if (hour < 12) return 'Buenos días'
  if (hour < 20) return 'Buenas tardes'
  return 'Buenas noches'
}
