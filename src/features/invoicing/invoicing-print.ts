import type {
  InvoicePrintCopies,
  InvoicePrintFormat,
  TaxIssuer,
  TimbradoMode,
} from './invoicing-types'

/**
 * Preferencias de impresión de un emisor fiscal.
 *
 * El formato vive en `tax_issuers` (no en el timbrado) porque es una decisión
 * operativa del profesional o de la clínica: el mismo RUC puede cambiar de
 * impresora sin tocar el rango autorizado por la SET.
 */

export type InvoicePrintFormatOption = {
  value: InvoicePrintFormat
  label: string
  /** Etiqueta corta para badges y botones segmentados. */
  shortLabel: string
  description: string
  hint: string
}

export const INVOICE_PRINT_FORMAT_OPTIONS: InvoicePrintFormatOption[] = [
  {
    value: 'electronic_kude',
    label: 'Factura Electrónica (KuDE A4)',
    shortLabel: 'KuDE A4',
    description: 'Hoja completa con QR y CDC de 44 dígitos para el SIFEN.',
    hint: 'Se imprime el KuDE con el CDC; el QR definitivo lo agrega el proveedor SIFEN.',
  },
  {
    value: 'autoimpresor_a4',
    label: 'Autoimpresor (A4 completo)',
    shortLabel: 'Autoimpresor A4',
    description: 'Diseño fiscal completo sobre una hoja A4 en blanco.',
    hint: 'Ideal para impresoras láser o inyección con hoja común.',
  },
  {
    value: 'preprinted_overlay',
    label: 'Preimpreso (Solo datos / Caída)',
    shortLabel: 'Preimpreso',
    description:
      'Imprime únicamente los valores, sin bordes ni membretes, para calzar sobre formularios preimpresos.',
    hint: 'Ajustá el margen superior e izquierdo hasta que los datos caigan en las casillas.',
  },
  {
    value: 'manual_none',
    label: 'Manual (Sin impresión fiscal)',
    shortLabel: 'Manual',
    description:
      'Para talonarios llenados a mano: solo registra en el Libro de Ventas y permite imprimir un Recibo de Dinero A4.',
    hint: 'No se imprime factura fiscal: el comprobante es el talonario preimpreso.',
  },
]

export const INVOICE_PRINT_FORMAT_LABELS: Record<InvoicePrintFormat, string> = {
  electronic_kude: 'Factura electrónica (KuDE A4)',
  autoimpresor_a4: 'Autoimpresor (A4 completo)',
  preprinted_overlay: 'Preimpreso (solo datos)',
  manual_none: 'Manual (sin impresión fiscal)',
}

export const INVOICE_PRINT_FORMAT_SHORT_LABELS: Record<InvoicePrintFormat, string> = {
  electronic_kude: 'KuDE A4',
  autoimpresor_a4: 'Autoimpresor A4',
  preprinted_overlay: 'Preimpreso',
  manual_none: 'Manual',
}

export type InvoicePrintCopyOption = {
  value: InvoicePrintCopies
  label: string
  description: string
}

export const INVOICE_PRINT_COPY_OPTIONS: InvoicePrintCopyOption[] = [
  {
    value: 'original_only',
    label: 'Solo original',
    description: 'Una hoja para el cliente.',
  },
  {
    value: 'original_duplicate',
    label: 'Original + duplicado',
    description: 'Original para el cliente y duplicado para el archivo del consultorio.',
  },
]

export const INVOICE_PRINT_COPY_LABELS: Record<InvoicePrintCopies, string> = {
  original_only: 'Solo original',
  original_duplicate: 'Original + duplicado',
}

/** El guaraní no usa decimales en pantalla, pero la calibración sí (0,5 mm). */
export const PRINT_OFFSET_MIN_MM = -50
export const PRINT_OFFSET_MAX_MM = 50

/** Configuración resuelta con la que se dibuja una factura. */
export type IssuerPrintSettings = {
  format: InvoicePrintFormat
  copies: InvoicePrintCopies
  offsetXmm: number
  offsetYmm: number
}

export const DEFAULT_PRINT_SETTINGS: IssuerPrintSettings = {
  format: 'autoimpresor_a4',
  copies: 'original_duplicate',
  offsetXmm: 0,
  offsetYmm: 0,
}

/** `invoice.mode` es la fuente de respaldo cuando el emisor todavía no cargó. */
export function getSuggestedPrintFormat(mode: TimbradoMode): InvoicePrintFormat {
  switch (mode) {
    case 'electronic':
      return 'electronic_kude'
    case 'preprinted':
      return 'preprinted_overlay'
    case 'manual':
      return 'manual_none'
    case 'autoimpresor':
    default:
      return 'autoimpresor_a4'
  }
}

export function normalizePrintFormat(value: unknown): InvoicePrintFormat {
  return INVOICE_PRINT_FORMAT_OPTIONS.some((option) => option.value === value)
    ? (value as InvoicePrintFormat)
    : DEFAULT_PRINT_SETTINGS.format
}

export function normalizePrintCopies(value: unknown): InvoicePrintCopies {
  return INVOICE_PRINT_COPY_OPTIONS.some((option) => option.value === value)
    ? (value as InvoicePrintCopies)
    : DEFAULT_PRINT_SETTINGS.copies
}

/**
 * Redondea a 0,5 mm y acota a ±50 mm (mismo rango que el CHECK de la base).
 *
 * Acepta el texto tal como se tipea en el consultorio: `-2,5` (coma decimal) o
 * `-2.5`. Los valores vacíos o inválidos vuelven a 0 para no romper la hoja.
 */
export function normalizePrintOffset(value: unknown): number {
  const parsed =
    typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'))

  if (!Number.isFinite(parsed)) return 0

  const clamped = Math.min(Math.max(parsed, PRINT_OFFSET_MIN_MM), PRINT_OFFSET_MAX_MM)

  return Math.round(clamped * 2) / 2
}

/** `-2.5` → `-2,5 mm`; `0` → `0,0 mm`. */
export function formatPrintOffset(value: number): string {
  const normalized = normalizePrintOffset(value)

  return `${normalized.toFixed(1).replace('.', ',')} mm`
}

/**
 * Preferencias efectivas del emisor.
 *
 * Si el emisor todavía no cargó (o la migración aún no está aplicada) se usa la
 * modalidad del timbrado de la factura como sugerencia.
 */
export function resolveIssuerPrintSettings(
  issuer:
    | Partial<
        Pick<
          TaxIssuer,
          'print_format' | 'print_copies' | 'print_offset_x_mm' | 'print_offset_y_mm'
        >
      >
    | null
    | undefined,
  fallbackMode?: TimbradoMode | null,
): IssuerPrintSettings {
  return {
    format:
      issuer?.print_format !== undefined
        ? normalizePrintFormat(issuer.print_format)
        : fallbackMode
          ? getSuggestedPrintFormat(fallbackMode)
          : DEFAULT_PRINT_SETTINGS.format,
    copies: normalizePrintCopies(issuer?.print_copies),
    offsetXmm: normalizePrintOffset(issuer?.print_offset_x_mm ?? 0),
    offsetYmm: normalizePrintOffset(issuer?.print_offset_y_mm ?? 0),
  }
}

export function isOverlayPrintFormat(format: InvoicePrintFormat): boolean {
  return format === 'preprinted_overlay'
}

/** El talonario manual no imprime factura fiscal (sí un Recibo de Dinero). */
export function isManualPrintFormat(format: InvoicePrintFormat): boolean {
  return format === 'manual_none'
}

/**
 * Rótulos de las hojas a imprimir. El preimpreso siempre usa una sola hoja: se
 * imprime sobre el formulario físico del talonario.
 */
export function getPrintCopyLabels(
  format: InvoicePrintFormat,
  copies: InvoicePrintCopies,
): string[] {
  if (format === 'preprinted_overlay') return ['ORIGINAL']

  return copies === 'original_duplicate'
    ? ['ORIGINAL — CLIENTE', 'DUPLICADO — ARCHIVO']
    : ['ORIGINAL — CLIENTE']
}

/** Resumen de una línea para la lista de emisores de Configuración. */
export function describeIssuerPrintSettings(
  issuer: Pick<
    TaxIssuer,
    'print_format' | 'print_copies' | 'print_offset_x_mm' | 'print_offset_y_mm'
  >,
): string {
  const settings = resolveIssuerPrintSettings(issuer)

  if (settings.format === 'manual_none') return INVOICE_PRINT_FORMAT_SHORT_LABELS.manual_none

  if (isOverlayPrintFormat(settings.format)) {
    return `${INVOICE_PRINT_FORMAT_SHORT_LABELS.preprinted_overlay} · margen X ${formatPrintOffset(
      settings.offsetXmm,
    )} / Y ${formatPrintOffset(settings.offsetYmm)}`
  }

  return `${INVOICE_PRINT_FORMAT_SHORT_LABELS[settings.format]} · ${
    INVOICE_PRINT_COPY_LABELS[settings.copies]
  }`
}

