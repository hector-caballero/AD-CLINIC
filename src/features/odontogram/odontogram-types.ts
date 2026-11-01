import type { Treatment } from '../treatments/treatment-types'

/**
 * Tipos y reglas del odontograma (`public.odontograms` y `public.odontogram_items`).
 *
 * - Cada ítem apunta a una pieza en notación FDI: permanente `11-48` y temporal
 *   `51-85`. La dentición se guarda en el odontograma (uno por paciente y
 *   dentición) y la base valida la pieza contra ella.
 * - `surface` es opcional: `null` significa «pieza completa» (corona,
 *   extracción, ausencia…). Las cinco caras son oclusal, vestibular,
 *   lingual/palatino, mesial y distal.
 * - `unit_price` está en guaraníes (PYG) y se congela al presupuestar; el
 *   `total_price` lo calcula la base (`quantity * unit_price`).
 *
 * Convención de colores (la misma en el SVG, la leyenda y el presupuesto):
 * rojo = patología/pendiente · verde = presupuestado · azul = realizado ·
 * gris = pieza ausente.
 */

export type Dentition = 'permanent' | 'temporary'

export type ToothArch = 'upper' | 'lower'

export type ToothSurface = 'occlusal' | 'vestibular' | 'lingual' | 'mesial' | 'distal'

export type OdontogramItemStatus = 'pending' | 'budgeted' | 'completed' | 'absent'

/** Fila de `public.odontograms` (columnas que usa la interfaz). */
export type Odontogram = {
  id: string
  patient_id: string
  dentition: Dentition
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Referencia mínima al catálogo embebida en cada ítem. */
export type TreatmentRef = Pick<
  Treatment,
  'id' | 'code' | 'name' | 'category' | 'default_price'
>

/** Fila de `public.odontogram_items` con el tratamiento embebido. */
export type OdontogramItem = {
  id: string
  odontogram_id: string
  tooth_number: number
  surface: ToothSurface | null
  status: OdontogramItemStatus
  treatment_id: string | null
  quantity: number
  /** Precio unitario en guaraníes. */
  unit_price: number
  /** Columna generada por la base: `quantity * unit_price`. */
  total_price: number
  notes: string | null
  performed_at: string | null
  /**
   * `patient_treatments.id` creado al cobrar la línea en caja.
   * `null` = todavía no cobrado.
   */
  patient_treatment_id: string | null
  created_at: string
  updated_at: string
  treatment: TreatmentRef | null
}

/** Datos que envía el modal de la pieza al servicio. */
export type OdontogramItemInput = {
  patientId: string
  dentition: Dentition
  toothNumber: number
  surface: ToothSurface | null
  status: OdontogramItemStatus
  treatmentId: string | null
  quantity: number
  unitPrice: number
  notes: string | null
}

/** Datos del modal de la pieza (el paciente y la dentición los pone el hook). */
export type OdontogramDraft = Omit<OdontogramItemInput, 'patientId' | 'dentition'>

/** Cambios admitidos sobre un ítem ya guardado. */
export type OdontogramItemPatch = {
  status?: OdontogramItemStatus
  quantity?: number
  unit_price?: number
  notes?: string | null
  /** Solo se usa al marcar una pieza como ausente. */
  surface?: ToothSurface | null
  treatment_id?: string | null
  performed_at?: string | null
}

/** Pieza y cara elegidas en el SVG (cara `null` = pieza completa). */
export type ToothSelection = {
  toothNumber: number
  surface: ToothSurface | null
}

export const ODONTOGRAM_SELECT = [
  'id',
  'patient_id',
  'dentition',
  'notes',
  'created_by',
  'created_at',
  'updated_at',
].join(', ')

const TREATMENT_EMBED = ['id', 'code', 'name', 'category', 'default_price'].join(', ')

export const ODONTOGRAM_ITEM_SELECT = [
  'id',
  'odontogram_id',
  'tooth_number',
  'surface',
  'status',
  'treatment_id',
  'quantity',
  'unit_price',
  'total_price',
  'notes',
  'performed_at',
  'patient_treatment_id',
  'created_at',
  'updated_at',
  `treatment:treatments(${TREATMENT_EMBED})`,
].join(', ')

export const SURFACE_OPTIONS: { value: ToothSurface; label: string; shortLabel: string }[] = [
  { value: 'occlusal', label: 'Oclusal / incisal', shortLabel: 'Oclusal' },
  { value: 'vestibular', label: 'Vestibular (bucal o labial)', shortLabel: 'Vestibular' },
  { value: 'lingual', label: 'Lingual / palatino', shortLabel: 'Lingual' },
  { value: 'mesial', label: 'Mesial', shortLabel: 'Mesial' },
  { value: 'distal', label: 'Distal', shortLabel: 'Distal' },
]

export function getSurfaceLabel(surface: ToothSurface | null | undefined): string {
  if (!surface) return 'Pieza completa'

  return SURFACE_OPTIONS.find((option) => option.value === surface)?.shortLabel ?? 'Cara'
}

export type ItemStatusMeta = {
  label: string
  /** Etiqueta corta para chips y leyendas. */
  shortLabel: string
  description: string
  /** Relleno de la cara en el SVG. */
  fill: string
  /** Relleno tenue para la pieza completa. */
  softFill: string
  /** Clases del badge en la interfaz. */
  badge: string
  /** Clases del punto de color. */
  dot: string
  /** Clases del monto. */
  tone: string
}

export const ITEM_STATUS_META: Record<OdontogramItemStatus, ItemStatusMeta> = {
  pending: {
    label: 'Pendiente',
    shortLabel: 'Patología',
    description: 'Patología detectada que todavía no se trató.',
    fill: '#dc2626',
    softFill: '#fee2e2',
    badge: 'bg-red-50 text-red-700 ring-red-200',
    dot: 'bg-red-500',
    tone: 'text-red-700',
  },
  budgeted: {
    label: 'Presupuestado',
    shortLabel: 'Presupuesto',
    description: 'Procedimiento incluido en el plan de tratamiento.',
    fill: '#16a34a',
    softFill: '#dcfce7',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    dot: 'bg-emerald-500',
    tone: 'text-emerald-700',
  },
  completed: {
    label: 'Realizado',
    shortLabel: 'Realizado',
    description: 'Procedimiento realizado en la clínica.',
    fill: '#2563eb',
    softFill: '#dbeafe',
    badge: 'bg-blue-50 text-blue-700 ring-blue-200',
    dot: 'bg-blue-500',
    tone: 'text-blue-700',
  },
  absent: {
    label: 'Ausente',
    shortLabel: 'Ausente',
    description: 'Pieza ausente o extraída.',
    fill: '#94a3b8',
    softFill: '#e2e8f0',
    badge: 'bg-slate-100 text-slate-600 ring-slate-200',
    dot: 'bg-slate-400',
    tone: 'text-slate-600',
  },
}

/** Orden clínico del plan: primero lo que duele, después lo presupuestado. */
export const STATUS_ORDER: OdontogramItemStatus[] = ['pending', 'budgeted', 'completed', 'absent']

/** Para pintar una cara con varios ítems gana el estado más relevante. */
const STATUS_WEIGHT: Record<OdontogramItemStatus, number> = {
  pending: 4,
  budgeted: 3,
  completed: 2,
  absent: 1,
}

export function getDominantStatus(items: OdontogramItem[]): OdontogramItemStatus | null {
  let winner: OdontogramItemStatus | null = null

  for (const item of items) {
    if (!winner || STATUS_WEIGHT[item.status] > STATUS_WEIGHT[winner]) winner = item.status
  }

  return winner
}

/** `true` cuando la pieza está marcada como ausente. */
export function isAbsentTooth(items: OdontogramItem[], toothNumber: number): boolean {
  return items.some((item) => item.tooth_number === toothNumber && item.status === 'absent')
}

/** Ítems de una cara concreta (`null` = los de pieza completa). */
export function getSurfaceItems(
  items: OdontogramItem[],
  toothNumber: number,
  surface: ToothSurface | null,
): OdontogramItem[] {
  return items.filter((item) => item.tooth_number === toothNumber && item.surface === surface)
}

export type OdontogramTotals = {
  /** Total del plan: todos los ítems con precio (no cuenta los ausentes). */
  plan: number
  pending: number
  budgeted: number
  completed: number
  /** Cantidad de ítems con precio. */
  items: number
  /** Cantidad de piezas marcadas como ausentes. */
  absentTeeth: number
}

/** Importe de una línea en guaraníes (las piezas ausentes no suman). */
export function getItemAmount(item: OdontogramItem): number {
  if (item.status === 'absent') return 0

  return Math.round(Math.max(1, item.quantity) * Math.max(0, item.unit_price))
}

/** Totales del presupuesto en guaraníes. */
export function computeOdontogramTotals(items: OdontogramItem[]): OdontogramTotals {
  const totals: OdontogramTotals = {
    plan: 0,
    pending: 0,
    budgeted: 0,
    completed: 0,
    items: 0,
    absentTeeth: 0,
  }

  for (const item of items) {
    if (item.status === 'absent') {
      totals.absentTeeth += 1
      continue
    }

    const amount = getItemAmount(item)

    totals.plan += amount
    totals.items += 1

    if (item.status === 'pending') totals.pending += amount
    else if (item.status === 'budgeted') totals.budgeted += amount
    else totals.completed += amount
  }

  return totals
}

/** `true` cuando la línea ya tiene un movimiento de caja asociado. */
export function isBilledItem(item: OdontogramItem): boolean {
  return Boolean(item.patient_treatment_id)
}

/**
 * Líneas que «Cobrar este plan» puede enviar a caja: procedimiento del
 * catálogo, precio mayor a cero y sin cobro previo. Las piezas ausentes y las
 * líneas sin precio quedan afuera porque la caja no registra importes en cero.
 */
export function isChargeableItem(item: OdontogramItem): boolean {
  return (
    item.status !== 'absent' &&
    Boolean(item.treatment_id) &&
    item.unit_price > 0 &&
    !isBilledItem(item)
  )
}

/** Líneas cobrables ordenadas como el panel, para que el cobro sea estable. */
export function getChargeableItems(items: OdontogramItem[]): OdontogramItem[] {
  return sortOdontogramItems(items.filter(isChargeableItem))
}

/**
 * Resumen legible del plan para las notas del movimiento de caja, por ejemplo
 * `Plan odontograma: Pieza 16 oclusal · Obturación; Pieza 26 pieza completa · Corona`.
 */
export function buildChargeNote(items: OdontogramItem[], limit = 480): string {
  const parts = items.map(
    (item) =>
      `Pieza ${item.tooth_number} ${getSurfaceLabel(item.surface).toLowerCase()} · ${
        item.treatment?.name ?? 'Procedimiento'
      }`,
  )

  const note =
    parts.length > 0 ? `Plan odontograma: ${parts.join('; ')}` : 'Plan odontograma'

  if (note.length <= limit) return note

  return `${note.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

/** Orden del panel: estado, pieza y cara. */
export function sortOdontogramItems(items: OdontogramItem[]): OdontogramItem[] {
  return [...items].sort((a, b) => {
    const byStatus = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)

    if (byStatus !== 0) return byStatus
    if (a.tooth_number !== b.tooth_number) return a.tooth_number - b.tooth_number

    const bySurface = (a.surface ?? 'zz').localeCompare(b.surface ?? 'zz', 'es')

    if (bySurface !== 0) return bySurface

    return a.created_at.localeCompare(b.created_at)
  })
}

/** Descripción legible de un ítem: `16 · Oclusal · Obturación con resina`. */
export function getItemLabel(item: OdontogramItem): string {
  const treatment = item.treatment?.name ?? 'Procedimiento'

  return `${item.tooth_number} · ${getSurfaceLabel(item.surface)} · ${treatment}`
}
