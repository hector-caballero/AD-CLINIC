import type { PaymentMethod } from '../cash/cash-types'

/**
 * Tipos del módulo de facturación y gastos (Paraguay).
 *
 * El consultorio puede operar de dos maneras y cambiarlo en caliente desde
 * Configuración (`clinic_tax_settings.operational_mode`):
 *
 * - `multi_issuer`: cada profesional es un emisor con su propio RUC y timbrados
 *   (personas físicas independientes). Al facturar se elige quién emite.
 * - `single_company`: una sola empresa (RUC unificado) emite por todo el
 *   consultorio; se usa siempre el emisor predeterminado.
 *
 * Convenciones fiscales:
 * - Número de factura: `000-000-0000000` (establecimiento, punto, correlativo).
 * - Los importes incluyen IVA; el IVA se despeja con los divisores de la SET
 *   (10 % → importe / 11, 5 % → importe / 21, exenta → sin IVA).
 * - El guaraní no tiene centavos: todo se redondea a 1 ₲.
 */

export type OperationalMode = 'multi_issuer' | 'single_company'

export type TaxIssuerKind = 'individual' | 'company'

export type TimbradoMode = 'manual' | 'preprinted' | 'autoimpresor' | 'electronic'

export type InvoiceStatus = 'issued' | 'cancelled'

/** Tratamiento fiscal del importe facturado. */
export type VatRate = 'iva_10' | 'iva_5' | 'exempt'

/** Emisor de facturas: una persona física o la empresa del consultorio. */
export type TaxIssuer = {
  id: string
  kind: TaxIssuerKind
  /** Nombre que se imprime en la factura («Dra. Ana López»). */
  display_name: string
  /** Razón social o nombre completo legal. */
  legal_name: string
  /** RUC con dígito verificador (`80012345-6`). */
  ruc: string
  address: string | null
  phone: string | null
  email: string | null
  is_active: boolean
  /** Perfil del profesional (`profiles.id`) al que pertenece este emisor. */
  linked_user_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** Fila única de `clinic_tax_settings`. */
export type ClinicTaxSettings = {
  id: number
  operational_mode: OperationalMode
  default_issuer_id: string | null
  legal_name: string | null
  ruc: string | null
  address: string | null
  phone: string | null
  email: string | null
  created_at: string
  updated_at: string
}

/** Timbrado autorizado por la SET para un emisor. */
export type InvoicingTimbrado = {
  id: string
  issuer_id: string
  /** Número de timbrado de 8 dígitos. */
  timbrado_number: string
  /** Establecimiento (3 dígitos) y punto de expedición (3 dígitos). */
  establishment: string
  emission_point: string
  mode: TimbradoMode
  range_from: number
  range_to: number
  /** Último correlativo usado; `0` = todavía no se emitió. */
  last_number: number
  valid_from: string
  valid_until: string | null
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

/** Datos del emisor embebidos en una factura. */
export type InvoiceIssuerRef = Pick<TaxIssuer, 'id' | 'display_name' | 'ruc' | 'kind'>

export type InvoiceTimbradoRef = Pick<
  InvoicingTimbrado,
  'id' | 'timbrado_number' | 'mode'
>

/** Factura emitida (`public.invoices`). */
export type Invoice = {
  id: string
  issuer_id: string
  timbrado_id: string | null
  patient_id: string | null
  transaction_id: string | null
  timbrado_number: string
  establishment: string
  emission_point: string
  sequence_number: number
  invoice_number: string
  mode: TimbradoMode
  cdc: string | null
  status: InvoiceStatus
  issued_at: string
  customer_name: string
  customer_ruc: string | null
  customer_document: string | null
  customer_email: string | null
  customer_address: string | null
  vat_rate: VatRate
  /** Importes con IVA incluido, por franja. */
  amount_10: number
  amount_5: number
  amount_exempt: number
  /** IVA despejado de cada franja. */
  iva_10: number
  iva_5: number
  total: number
  currency: string
  payment_method: PaymentMethod | null
  notes: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  created_at: string
  updated_at: string
  issuer: InvoiceIssuerRef | null
  timbrado: InvoiceTimbradoRef | null
}

/** Factura de gasto / compra (`public.expense_invoices`). */
export type ExpenseInvoice = {
  id: string
  supplier_name: string
  supplier_ruc: string | null
  timbrado_number: string | null
  invoice_number: string
  expense_kind: string | null
  issued_on: string
  description: string | null
  amount_10: number
  amount_5: number
  amount_exempt: number
  iva_10: number
  iva_5: number
  total: number
  currency: string
  payment_method: PaymentMethod | null
  /** `null` = gasto general de la clínica. */
  attributed_issuer_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
  attributed_issuer: InvoiceIssuerRef | null
}


/** Columnas de `tax_issuers`. */
export const TAX_ISSUER_SELECT =
  'id, kind, display_name, legal_name, ruc, address, phone, email, is_active, linked_user_id, notes, created_at, updated_at'

/** Columnas de `clinic_tax_settings`. */
export const CLINIC_TAX_SETTINGS_SELECT =
  'id, operational_mode, default_issuer_id, legal_name, ruc, address, phone, email, created_at, updated_at'

/** Columnas de `invoicing_timbrados`. */
export const TIMBRADO_SELECT = [
  'id',
  'issuer_id',
  'timbrado_number',
  'establishment',
  'emission_point',
  'mode',
  'range_from',
  'range_to',
  'last_number',
  'valid_from',
  'valid_until',
  'is_active',
  'notes',
  'created_at',
  'updated_at',
].join(', ')

const ISSUER_EMBED = 'id, display_name, ruc, kind'

/** Columnas de `invoices` con el emisor y el timbrado embebidos. */
export const INVOICE_SELECT = [
  'id',
  'issuer_id',
  'timbrado_id',
  'patient_id',
  'transaction_id',
  'timbrado_number',
  'establishment',
  'emission_point',
  'sequence_number',
  'invoice_number',
  'mode',
  'cdc',
  'status',
  'issued_at',
  'customer_name',
  'customer_ruc',
  'customer_document',
  'customer_email',
  'customer_address',
  'vat_rate',
  'amount_10',
  'amount_5',
  'amount_exempt',
  'iva_10',
  'iva_5',
  'total',
  'currency',
  'payment_method',
  'notes',
  'cancelled_at',
  'cancellation_reason',
  'created_at',
  'updated_at',
  `issuer:tax_issuers(${ISSUER_EMBED})`,
  'timbrado:invoicing_timbrados(id, timbrado_number, mode)',
].join(', ')

/** Columnas de `expense_invoices` con el emisor imputado embebido. */
export const EXPENSE_INVOICE_SELECT = [
  'id',
  'supplier_name',
  'supplier_ruc',
  'timbrado_number',
  'invoice_number',
  'expense_kind',
  'issued_on',
  'description',
  'amount_10',
  'amount_5',
  'amount_exempt',
  'iva_10',
  'iva_5',
  'total',
  'currency',
  'payment_method',
  'attributed_issuer_id',
  'notes',
  'created_at',
  'updated_at',
  `attributed_issuer:tax_issuers(${ISSUER_EMBED})`,
].join(', ')


export type OperationalModeOption = {
  value: OperationalMode
  label: string
  description: string
}

export const OPERATIONAL_MODE_OPTIONS: OperationalModeOption[] = [
  {
    value: 'multi_issuer',
    label: 'Multi-emisor',
    description:
      'Cada profesional emite sus facturas con su propio RUC y timbrados. Al facturar se elige el emisor.',
  },
  {
    value: 'single_company',
    label: 'Modo empresa',
    description:
      'Una sola empresa con RUC unificado factura por todo el consultorio. Se usa siempre el emisor predeterminado.',
  },
]

export const OPERATIONAL_MODE_LABELS: Record<OperationalMode, string> = {
  multi_issuer: 'Multi-emisor',
  single_company: 'Modo empresa',
}

export const ISSUER_KIND_OPTIONS: {
  value: TaxIssuerKind
  label: string
  description: string
}[] = [
  {
    value: 'individual',
    label: 'Persona física',
    description: 'Profesional independiente que factura con su RUC personal.',
  },
  {
    value: 'company',
    label: 'Persona jurídica',
    description: 'Empresa o consultorio con RUC unificado.',
  },
]

export const ISSUER_KIND_LABELS: Record<TaxIssuerKind, string> = {
  individual: 'Persona física',
  company: 'Persona jurídica',
}

export type TimbradoModeOption = {
  value: TimbradoMode
  label: string
  description: string
  /** Cómo se comporta el campo de número para esta modalidad. */
  numberHint: string
}

export const TIMBRADO_MODE_OPTIONS: TimbradoModeOption[] = [
  {
    value: 'autoimpresor',
    label: 'Autoimpresor',
    description: 'El sistema asigna el correlativo automáticamente al emitir.',
    numberHint: 'Correlativo automático y ascendente.',
  },
  {
    value: 'electronic',
    label: 'Electrónica (SIFEN)',
    description: 'Correlativo automático y CDC de 44 dígitos para el SIFEN.',
    numberHint: 'Correlativo automático; el CDC se genera al emitir.',
  },
  {
    value: 'preprinted',
    label: 'Preimpreso',
    description: 'Talonario ya impreso: el correlativo cae desde el tope del rango.',
    numberHint: 'Correlativo en caída: el número baja en cada emisión.',
  },
  {
    value: 'manual',
    label: 'Manual',
    description: 'Cada comprobante se carga a mano con su número.',
    numberHint: 'Número editable: ingresalo tal como figura en el comprobante.',
  },
]

export const TIMBRADO_MODE_LABELS: Record<TimbradoMode, string> = {
  manual: 'Manual',
  preprinted: 'Preimpreso',
  autoimpresor: 'Autoimpresor',
  electronic: 'Electrónica',
}

/** Las modalidades en las que el número lo decide el sistema. */
export function isAutomaticNumbering(mode: TimbradoMode): boolean {
  return mode === 'autoimpresor' || mode === 'electronic'
}

export const VAT_RATE_OPTIONS: { value: VatRate; label: string; detail: string }[] = [
  { value: 'iva_10', label: 'IVA 10 %', detail: 'Importe ÷ 11' },
  { value: 'iva_5', label: 'IVA 5 %', detail: 'Importe ÷ 21' },
  { value: 'exempt', label: 'Exenta', detail: 'Sin IVA' },
]

export const VAT_RATE_LABELS: Record<VatRate, string> = {
  iva_10: 'IVA 10 %',
  iva_5: 'IVA 5 %',
  exempt: 'Exenta',
}

export const INVOICE_STATUS_META: Record<InvoiceStatus, { label: string; badge: string }> = {
  issued: { label: 'Emitida', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  cancelled: { label: 'Anulada', badge: 'bg-slate-100 text-slate-500 ring-slate-200' },
}

/** Categorías sugeridas para clasificar el gasto. */
export const EXPENSE_KIND_OPTIONS = [
  'Insumos y materiales',
  'Alquiler',
  'Servicios básicos',
  'Sueldos y honorarios',
  'Mantenimiento',
  'Impuestos y tasas',
  'Otros',
]


/** Nombre visible del emisor (el que se imprime en la factura). */
export function getIssuerName(
  issuer: TaxIssuer | InvoiceIssuerRef | null | undefined,
): string {
  return issuer?.display_name?.trim() || 'Emisor sin nombre'
}

/** `Timbrado 12345678 · 001-001` */
export function getTimbradoLabel(
  timbrado: Pick<InvoicingTimbrado, 'timbrado_number' | 'establishment' | 'emission_point'>,
): string {
  return `Timbrado ${timbrado.timbrado_number} · ${timbrado.establishment}-${timbrado.emission_point}`
}

/** Rango autorizado con relleno de ceros: `0000001 al 0000100`. */
export function getTimbradoRangeLabel(
  timbrado: Pick<InvoicingTimbrado, 'range_from' | 'range_to'>,
): string {
  const from = String(timbrado.range_from).padStart(7, '0')
  const to = String(timbrado.range_to).padStart(7, '0')

  return `${from} al ${to}`
}

/** `true` si la vigencia del timbrado ya terminó (comparación por fecha local). */
export function isTimbradoExpired(
  timbrado: Pick<InvoicingTimbrado, 'valid_until'>,
  todayKey: string,
): boolean {
  return Boolean(timbrado.valid_until && timbrado.valid_until < todayKey)
}

/**
 * `true` cuando ya no quedan correlativos.
 * Los preimpresos se consumen desde el tope del rango hacia abajo.
 */
export function isTimbradoExhausted(
  timbrado: Pick<InvoicingTimbrado, 'mode' | 'range_from' | 'range_to' | 'last_number'>,
): boolean {
  if (timbrado.last_number === 0) return false

  return timbrado.mode === 'preprinted'
    ? timbrado.last_number <= timbrado.range_from
    : timbrado.last_number >= timbrado.range_to
}

/** Timbrado listo para usar: activo, vigente y con números disponibles. */
export function isTimbradoUsable(
  timbrado: InvoicingTimbrado,
  todayKey: string,
): boolean {
  return (
    timbrado.is_active &&
    !isTimbradoExpired(timbrado, todayKey) &&
    !isTimbradoExhausted(timbrado)
  )
}

/** Timbrados del emisor, sin filtrar por vigencia (para la pantalla de configuración). */
export function getIssuerTimbrados(
  timbrados: InvoicingTimbrado[],
  issuerId: string | null,
): InvoicingTimbrado[] {
  if (!issuerId) return []

  return timbrados.filter((timbrado) => timbrado.issuer_id === issuerId)
}

/** Timbrados que se pueden elegir al facturar (activos, vigentes y con saldo). */
export function getSelectableTimbrados(
  timbrados: InvoicingTimbrado[],
  issuerId: string | null,
  todayKey: string,
): InvoicingTimbrado[] {
  return getIssuerTimbrados(timbrados, issuerId)
    .filter((timbrado) => isTimbradoUsable(timbrado, todayKey))
    .sort((a, b) => b.valid_from.localeCompare(a.valid_from))
}

/** Emisores habilitados para facturar. */
export function getActiveIssuers(issuers: TaxIssuer[]): TaxIssuer[] {
  return issuers.filter((issuer) => issuer.is_active)
}

/**
 * Emisor predeterminado según el modo operativo:
 * - `single_company`: el configurado o, si falta, la primera empresa activa.
 * - `multi_issuer`: el configurado o el primer emisor activo (solo como
 *   preselección; la persona que factura puede cambiarlo).
 */
export function getDefaultIssuer(
  settings: ClinicTaxSettings | null,
  issuers: TaxIssuer[],
): TaxIssuer | null {
  const active = getActiveIssuers(issuers)
  const configured = settings
    ? active.find((issuer) => issuer.id === settings.default_issuer_id)
    : undefined

  if (configured) return configured
  if (settings?.operational_mode === 'single_company') {
    return active.find((issuer) => issuer.kind === 'company') ?? active[0] ?? null
  }

  return active[0] ?? null
}

/**
 * Emisor sugerido para una factura.
 *
 * En `single_company` no hay elección: siempre el emisor de la clínica.
 * En `multi_issuer` se busca el emisor del profesional que atendió el
 * tratamiento (`linked_user_id`) y, si no existe, se usa el predeterminado.
 */
export function suggestIssuer(
  settings: ClinicTaxSettings | null,
  issuers: TaxIssuer[],
  dentistId: string | null | undefined,
): TaxIssuer | null {
  if (settings?.operational_mode !== 'multi_issuer' || !dentistId) {
    return getDefaultIssuer(settings, issuers)
  }

  const own = getActiveIssuers(issuers).find(
    (issuer) => issuer.linked_user_id === dentistId,
  )

  return own ?? getDefaultIssuer(settings, issuers)
}

/** Documento del cliente tal como se imprime en la factura. */
export function getInvoiceCustomerDocument(
  invoice: Pick<Invoice, 'customer_ruc' | 'customer_document'>,
): string {
  if (invoice.customer_ruc) return `RUC ${invoice.customer_ruc}`
  if (invoice.customer_document) return `CI ${invoice.customer_document}`

  return 'Sin documento'
}

/** A quién se imputó el gasto: la clínica o un emisor/doctor. */
export function getExpenseAttributionLabel(
  expense: Pick<ExpenseInvoice, 'attributed_issuer'>,
): string {
  return expense.attributed_issuer
    ? getIssuerName(expense.attributed_issuer)
    : 'Clínica (general)'
}
