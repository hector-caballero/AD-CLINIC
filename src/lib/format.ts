/**
 * Utilidades de formato compartidas por la interfaz.
 *
 * Convenciones de Paraguay:
 * - Moneda: guaraní (PYG), sin decimales y con punto como separador de miles.
 * - Documentos: C.I. `1.234.567`, RUC `80012345-6`, pasaporte alfanumérico.
 * - Teléfonos: móvil `0981 123 456`, fijo `021 123 456`, internacional `+595 ...`.
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

/** `1.234.567` — Cédula de Identidad paraguaya (máximo 8 dígitos). */
export function formatCI(value: string): string {
  return groupThousands(onlyDigits(value).slice(0, 8))
}

/** `80012345-6` — RUC: hasta 8 dígitos de base + dígito verificador. */
export function formatRUC(value: string): string {
  const digits = onlyDigits(value).slice(0, 9)

  if (digits.length <= 8) return digits

  return `${digits.slice(0, 8)}-${digits.slice(8)}`
}

/** Formatea el documento mientras se escribe, según el tipo elegido. */
export function formatDocumentNumber(value: string, type: ParaguayDocumentType): string {
  if (type === 'CI') return formatCI(value)
  if (type === 'RUC') return formatRUC(value)

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

  return onlyDigits(source)
}

/** Normaliza el valor guardado en `patients.document_type` (tolera datos viejos). */
export function resolveDocumentType(value: string | null | undefined): ParaguayDocumentType {
  if (value === 'RUC' || value === 'Pasaporte') return value

  return 'CI'
}

/**
 * Validación estructural (no calcula el dígito verificador del RUC).
 * El RUC se acepta con o sin dígito verificador porque hay formularios que
 * piden solo la base.
 */
export function isValidDocumentNumber(value: string, type: ParaguayDocumentType): boolean {
  const normalized = normalizeDocumentNumber(value, type)

  if (!normalized) return false
  if (type === 'CI') return /^\d{5,8}$/.test(normalized)
  if (type === 'RUC') return /^\d{7,9}$/.test(normalized)

  return /^[A-Z0-9]{6,12}$/.test(normalized)
}

/** Etiqueta corta del documento: `C.I. 1.234.567`, `RUC 80012345-6`. */
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

  return `${labels[type]} ${formatDocumentNumber(raw, type)}`
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
