import type { Patient } from '../patients/patient-types'

/**
 * Tipos del módulo de caja.
 *
 * La base usa tres enums para clasificar cada movimiento:
 * - `transaction_type`: `charge` (cargo), `payment` (pago/abono), `refund`
 *   (devolución) y `adjustment` (descuento o ajuste).
 * - `transaction_status`: `pending`, `paid`, `partially_paid`, `refunded`,
 *   `cancelled`.
 * - `payment_method`: efectivo, tarjeta, transferencia/SIPAP, convenio u otro.
 *
 * Regla contable del esquema (`patient_balances`):
 * `saldo = cargos − ajustes − pagos confirmados + devoluciones`.
 * Por eso un cobro cobrado en el momento se registra como **cargo + pago**:
 * el cargo deja constancia del tratamiento y el pago es el dinero recibido.
 */

export type TransactionType = 'charge' | 'payment' | 'refund' | 'adjustment'

export type TransactionStatus = 'pending' | 'paid' | 'partially_paid' | 'refunded' | 'cancelled'

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'insurance' | 'other'

export type TreatmentStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled'

/** Período del historial de movimientos. */
export type CashPeriod = 'today' | 'month' | '30d' | 'all'

/** Filtro por tipo de movimiento en el historial. */
export type MovementTypeFilter = 'all' | 'charges' | 'payments' | 'adjustments'

/** Datos del paciente que la caja necesita para identificar y cobrar. */
export type CashPatient = Pick<
  Patient,
  'id' | 'first_name' | 'last_name' | 'phone' | 'document_type' | 'document_number'
>

/** Tratamiento del catálogo (columnas de `public.treatments`). */
export type TreatmentCatalogItem = {
  id: string
  code: string
  name: string
  category: string
  default_price: number
  default_duration_minutes: number
  is_active: boolean
}

/** Referencia mínima al tratamiento embebido dentro de `patient_treatments`. */
export type TreatmentRef = Pick<TreatmentCatalogItem, 'id' | 'code' | 'name' | 'category'>

/** Fila de `public.patient_treatments` con el tratamiento embebido. */
export type MovementTreatment = {
  id: string
  quantity: number
  unit_price: number
  total_price: number
  status: TreatmentStatus
  treatment: TreatmentRef | null
}

/** Movimiento de cuenta corriente con paciente y tratamiento embebidos. */
export type CashMovement = {
  id: string
  patient_id: string
  appointment_id: string | null
  patient_treatment_id: string | null
  type: TransactionType
  status: TransactionStatus
  method: PaymentMethod | null
  amount: number
  /** ISO 4217. La caja opera en guaraníes (`PYG`). */
  currency: string
  due_date: string | null
  paid_at: string | null
  receipt_number: string | null
  reference: string | null
  notes: string | null
  created_at: string
  updated_at: string
  patient: CashPatient | null
  patient_treatment: MovementTreatment | null
}

/** Fila de la vista `public.patient_balances`. */
export type PatientBalance = {
  patient_id: string
  first_name: string
  last_name: string
  phone: string
  total_charges: number
  total_adjustments: number
  total_payments: number
  total_refunds: number
  balance: number
  last_payment_at: string | null
}

/** Pago confirmado del mes en curso (base de «Cobrado hoy/mes»). */
export type PaymentRecord = {
  amount: number
  paid_at: string | null
}

/** Datos que alimentan las tarjetas de resumen. */
export type CashOverview = {
  /** Pagos con estado `paid` del mes en curso. */
  payments: PaymentRecord[]
  /** Saldos de todos los pacientes activos. */
  balances: PatientBalance[]
  treatments: {
    /** Tratamientos realizados (`patient_treatments.status = 'completed'`). */
    total: number
    /** Los realizados en el mes en curso. */
    month: number
  }
}

/** Ítem elegido en el modal de cobro (precio del catálogo congelado al cobrar). */
export type ChargeItemInput = {
  treatmentId: string
  quantity: number
  unitPrice: number
}

export type TreatmentChargeInput = {
  patientId: string
  items: ChargeItemInput[]
  /** `true` registra también el pago; `false` deja la deuda pendiente. */
  collected: boolean
  method: PaymentMethod | null
  receiptNumber: string | null
  notes: string | null
}

export type PaymentInput = {
  patientId: string
  amount: number
  method: PaymentMethod
  receiptNumber: string | null
  notes: string | null
  /** Concepto libre; por defecto «Abono a cuenta». */
  reference: string | null
}

export type MovementResult = {
  patientId: string
  kind: 'charge' | 'payment'
  total: number
  collected: boolean
}

/** Moneda con la que opera la clínica. */
export const CASH_CURRENCY = 'PYG'

const PATIENT_EMBED = [
  'id',
  'first_name',
  'last_name',
  'phone',
  'document_type',
  'document_number',
].join(', ')

const TREATMENT_EMBED = ['id', 'code', 'name', 'category'].join(', ')

/** Columnas del movimiento + paciente + tratamiento realizado. */
export const CASH_MOVEMENT_SELECT = [
  'id',
  'patient_id',
  'appointment_id',
  'patient_treatment_id',
  'type',
  'status',
  'method',
  'amount',
  'currency',
  'due_date',
  'paid_at',
  'receipt_number',
  'reference',
  'notes',
  'created_at',
  'updated_at',
  `patient:patients(${PATIENT_EMBED})`,
  `patient_treatment:patient_treatments(id, quantity, unit_price, total_price, status, treatment:treatments(${TREATMENT_EMBED}))`,
].join(', ')

export const BALANCE_SELECT = [
  'patient_id',
  'first_name',
  'last_name',
  'phone',
  'total_charges',
  'total_adjustments',
  'total_payments',
  'total_refunds',
  'balance',
  'last_payment_at',
].join(', ')

export const TREATMENT_SELECT = [
  'id',
  'code',
  'name',
  'category',
  'default_price',
  'default_duration_minutes',
  'is_active',
].join(', ')

type TypeMeta = {
  label: string
  /** Concepto por defecto cuando el movimiento no tiene referencia. */
  fallbackConcept: string
  badge: string
  /** Color del monto según su efecto en caja. */
  amountTone: string
}

export const TRANSACTION_TYPE_META: Record<TransactionType, TypeMeta> = {
  charge: {
    label: 'Cargo',
    fallbackConcept: 'Cargo por tratamiento',
    badge: 'bg-slate-100 text-slate-700 ring-slate-200',
    amountTone: 'text-slate-900',
  },
  payment: {
    label: 'Pago',
    fallbackConcept: 'Abono a cuenta',
    badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    amountTone: 'text-emerald-700',
  },
  refund: {
    label: 'Devolución',
    fallbackConcept: 'Devolución al paciente',
    badge: 'bg-rose-50 text-rose-700 ring-rose-200',
    amountTone: 'text-rose-700',
  },
  adjustment: {
    label: 'Ajuste',
    fallbackConcept: 'Ajuste de saldo',
    badge: 'bg-amber-50 text-amber-800 ring-amber-200',
    amountTone: 'text-amber-700',
  },
}

export const TRANSACTION_STATUS_META: Record<TransactionStatus, { label: string; badge: string }> = {
  pending: { label: 'Pendiente', badge: 'bg-amber-50 text-amber-800 ring-amber-200' },
  paid: { label: 'Pagado', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  partially_paid: { label: 'Pago parcial', badge: 'bg-sky-50 text-sky-700 ring-sky-200' },
  refunded: { label: 'Devuelto', badge: 'bg-rose-50 text-rose-700 ring-rose-200' },
  cancelled: { label: 'Anulado', badge: 'bg-slate-100 text-slate-500 ring-slate-200' },
}

export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'card', label: 'Tarjeta' },
  { value: 'transfer', label: 'Transferencia / SIPAP' },
  { value: 'insurance', label: 'Convenio / seguro' },
  { value: 'other', label: 'Otro' },
]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia / SIPAP',
  insurance: 'Convenio / seguro',
  other: 'Otro',
}

export const MOVEMENT_TYPE_FILTERS: { value: MovementTypeFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'charges', label: 'Cargos' },
  { value: 'payments', label: 'Pagos' },
  { value: 'adjustments', label: 'Ajustes' },
]

export function getCashPatientName(patient: CashPatient | null | undefined): string {
  if (!patient) return 'Paciente sin datos'

  return `${patient.first_name} ${patient.last_name}`.replace(/\s+/g, ' ').trim()
}

export function getMovementPatientName(movement: CashMovement): string {
  return getCashPatientName(movement.patient)
}

/**
 * Concepto legible del movimiento: el tratamiento cobrado cuando existe y, si
 * no, la referencia libre o el concepto por defecto del tipo.
 */
export function getMovementConcept(movement: CashMovement): string {
  const item = movement.patient_treatment
  const treatment = item?.treatment

  if (movement.type === 'charge' && treatment) {
    const quantity = item && item.quantity > 1 ? ` ×${item.quantity}` : ''

    return `${treatment.name}${quantity}`
  }

  const reference = movement.reference?.trim()

  if (reference) return reference

  return TRANSACTION_TYPE_META[movement.type].fallbackConcept
}

/** `true` cuando el movimiento todavía representa una deuda por cobrar. */
export function isPendingCharge(movement: CashMovement): boolean {
  return (
    movement.type === 'charge' &&
    (movement.status === 'pending' || movement.status === 'partially_paid')
  )
}
