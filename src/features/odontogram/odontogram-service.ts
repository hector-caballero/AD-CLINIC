import { supabase } from '../../lib/supabase'
import { toOdontogramError } from './odontogram-errors'
import { isValidTooth } from './odontogram-teeth'
import {
  ODONTOGRAM_ITEM_SELECT,
  ODONTOGRAM_SELECT,
  type Dentition,
  type Odontogram,
  type OdontogramItem,
  type OdontogramItemInput,
  type OdontogramItemPatch,
  type OdontogramItemStatus,
  type TreatmentRef,
} from './odontogram-types'

/**
 * Acceso a `public.odontograms` y `public.odontogram_items`.
 *
 * Reglas del servicio:
 * - El odontograma se crea la primera vez que se guarda un ítem
 *   (`ensureOdontogram`); hay uno por paciente y dentición.
 * - Un mismo tratamiento no se duplica sobre la misma pieza y cara: si ya
 *   existe, se actualiza (cantidad, precio, estado y notas).
 * - El precio viaja en guaraníes y se redondea; lo que no tiene precio es
 *   únicamente la marca de pieza ausente.
 * - Una línea con `patient_treatment_id` ya se cobró en caja: no se vuelve a
 *   cobrar, no cambia de estado y no se quita del odontograma (el ajuste se
 *   hace desde la caja).
 * - La validación fina (FDI según dentición, `performed_at`, RLS) vive en la
 *   base; acá solo se evitan errores obvios antes de viajar.
 */

/** Tope de ítems por odontograma (coincide con `db-max-rows` de PostgREST). */
export const ODONTOGRAM_ITEMS_LIMIT = 500

type RawTreatment = {
  id: string
  code: string
  name: string
  category: string
  default_price: unknown
}

type RawItem = {
  id: string
  odontogram_id: string
  tooth_number: number | string
  surface: OdontogramItem['surface']
  status: OdontogramItemStatus
  treatment_id: string | null
  quantity: unknown
  unit_price: unknown
  total_price: unknown
  notes: string | null
  performed_at: string | null
  patient_treatment_id: string | null
  created_at: string
  updated_at: string
  treatment: RawTreatment | RawTreatment[] | null
}

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(parsed) ? parsed : 0
}

/** PostgREST devuelve la relación como objeto; se tolera también el arreglo. */
function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null

  return Array.isArray(value) ? (value[0] ?? null) : value
}

function asOdontogram(data: unknown): Odontogram {
  return data as Odontogram
}

function normalizeTreatment(raw: RawTreatment | null): TreatmentRef | null {
  if (!raw) return null

  return {
    id: raw.id,
    code: raw.code,
    name: raw.name,
    category: raw.category,
    default_price: toNumber(raw.default_price),
  }
}

function normalizeItem(row: RawItem): OdontogramItem {
  return {
    ...row,
    tooth_number: toNumber(row.tooth_number),
    quantity: Math.max(1, Math.round(toNumber(row.quantity))),
    unit_price: Math.max(0, toNumber(row.unit_price)),
    total_price: Math.max(0, toNumber(row.total_price)),
    treatment: normalizeTreatment(firstOf(row.treatment)),
  }
}

function asItems(data: unknown): OdontogramItem[] {
  return ((data ?? []) as RawItem[]).map(normalizeItem)
}

export type OdontogramSnapshot = {
  odontogram: Odontogram | null
  items: OdontogramItem[]
}

/** Odontograma del paciente para una dentición, con sus ítems ordenados. */
export async function fetchOdontogram(
  patientId: string,
  dentition: Dentition,
): Promise<OdontogramSnapshot> {
  const { data, error } = await supabase
    .from('odontograms')
    .select(ODONTOGRAM_SELECT)
    .eq('patient_id', patientId)
    .eq('dentition', dentition)
    .maybeSingle()

  if (error) throw toOdontogramError(error)
  if (!data) return { odontogram: null, items: [] }

  const odontogram = asOdontogram(data)

  const { data: itemRows, error: itemsError } = await supabase
    .from('odontogram_items')
    .select(ODONTOGRAM_ITEM_SELECT)
    .eq('odontogram_id', odontogram.id)
    .order('tooth_number', { ascending: true })
    .order('surface', { ascending: true, nullsFirst: true })
    .limit(ODONTOGRAM_ITEMS_LIMIT)

  if (itemsError) throw toOdontogramError(itemsError)

  return { odontogram, items: asItems(itemRows) }
}

/**
 * Devuelve el odontograma existente o lo crea.
 * Si dos pestañas lo crean a la vez, la restricción unique devuelve `23505` y
 * se reintenta la lectura una sola vez.
 */
async function ensureOdontogram(
  patientId: string,
  dentition: Dentition,
  attempt = 0,
): Promise<Odontogram> {
  const { data, error } = await supabase
    .from('odontograms')
    .select(ODONTOGRAM_SELECT)
    .eq('patient_id', patientId)
    .eq('dentition', dentition)
    .maybeSingle()

  if (error) throw toOdontogramError(error)
  if (data) return asOdontogram(data)

  const { data: created, error: insertError } = await supabase
    .from('odontograms')
    .insert({ patient_id: patientId, dentition })
    .select(ODONTOGRAM_SELECT)
    .single()

  if (insertError) {
    if (insertError.code === '23505' && attempt === 0) {
      return ensureOdontogram(patientId, dentition, 1)
    }

    throw toOdontogramError(insertError)
  }

  if (!created) {
    throw new Error('Supabase no devolvió el odontograma creado. Recargá la página.')
  }

  return asOdontogram(created)
}

async function findExistingItem(
  odontogramId: string,
  toothNumber: number,
  surface: OdontogramItem['surface'],
  treatmentId: string | null,
): Promise<OdontogramItem | null> {
  let query = supabase
    .from('odontogram_items')
    .select(ODONTOGRAM_ITEM_SELECT)
    .eq('odontogram_id', odontogramId)
    .eq('tooth_number', toothNumber)

  query = surface ? query.eq('surface', surface) : query.is('surface', null)

  if (treatmentId) {
    query = query.eq('treatment_id', treatmentId).neq('status', 'absent')
  } else {
    query = query.eq('status', 'absent')
  }

  const { data, error } = await query
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw toOdontogramError(error)

  return data ? normalizeItem(data as unknown as RawItem) : null
}

/**
 * Agrega (o actualiza) un procedimiento en una pieza y cara.
 * Devuelve el ítem con el tratamiento embebido para refrescar la UI sin
 * recargar todo el odontograma.
 */
export async function addOdontogramItem(input: OdontogramItemInput): Promise<OdontogramItem> {
  if (!input.patientId) throw new Error('Elegí el paciente del odontograma.')

  if (!isValidTooth(input.toothNumber, input.dentition)) {
    throw new Error(`La pieza ${input.toothNumber} no corresponde a la dentición seleccionada.`)
  }

  const isAbsent = input.status === 'absent'
  const treatmentId = isAbsent ? null : input.treatmentId
  const surface = isAbsent ? null : input.surface
  const quantity = isAbsent ? 1 : Math.max(1, Math.min(20, Math.round(input.quantity)))
  const unitPrice = isAbsent ? 0 : Math.round(Math.max(0, input.unitPrice))

  if (!isAbsent && !treatmentId) throw new Error('Elegí el tratamiento del catálogo.')

  if (!isAbsent && unitPrice <= 0) {
    throw new Error('Ingresá el precio del procedimiento en guaraníes.')
  }

  const odontogram = await ensureOdontogram(input.patientId, input.dentition)
  const existing = await findExistingItem(odontogram.id, input.toothNumber, surface, treatmentId)

  if (existing?.patient_treatment_id) {
    throw new Error(
      `La pieza ${input.toothNumber} ya tiene este procedimiento cobrado en caja. Para cambiarlo, ajustá el movimiento desde Caja.`,
    )
  }

  const performedAt =
    input.status === 'completed'
      ? (existing?.performed_at ?? new Date().toISOString())
      : null

  const payload = {
    odontogram_id: odontogram.id,
    tooth_number: input.toothNumber,
    surface,
    status: input.status,
    treatment_id: treatmentId,
    quantity,
    unit_price: unitPrice,
    notes: input.notes?.trim() || null,
    performed_at: performedAt,
  }

  const query = existing
    ? supabase
        .from('odontogram_items')
        .update(payload)
        .eq('id', existing.id)
        .select(ODONTOGRAM_ITEM_SELECT)
        .single()
    : supabase
        .from('odontogram_items')
        .insert(payload)
        .select(ODONTOGRAM_ITEM_SELECT)
        .single()

  const { data, error } = await query

  if (error) throw toOdontogramError(error)
  if (!data) {
    throw new Error('Supabase no devolvió el procedimiento guardado. Recargá el odontograma.')
  }

  return normalizeItem(data as unknown as RawItem)
}

/**
 * Cambia el estado de un ítem. Marcar una pieza como ausente limpia el
 * tratamiento y el precio (lo describe la pieza, no un procedimiento).
 */
export async function setOdontogramItemStatus(
  itemId: string,
  status: OdontogramItemStatus,
): Promise<OdontogramItem> {
  await assertItemNotBilled(itemId)

  const patch: OdontogramItemPatch = { status }

  if (status === 'absent') {
    patch.surface = null
    patch.treatment_id = null
    patch.quantity = 1
    patch.unit_price = 0
    patch.performed_at = null
  } else {
    patch.performed_at = status === 'completed' ? new Date().toISOString() : null
  }

  const { data, error } = await supabase
    .from('odontogram_items')
    .update(patch)
    .eq('id', itemId)
    .select(ODONTOGRAM_ITEM_SELECT)
    .single()

  if (error) throw toOdontogramError(error)
  if (!data) throw new Error('El procedimiento ya no existe. Recargá el odontograma.')

  return normalizeItem(data as unknown as RawItem)
}

export async function removeOdontogramItem(itemId: string): Promise<void> {
  await assertItemNotBilled(itemId)

  const { error } = await supabase.from('odontogram_items').delete().eq('id', itemId)

  if (error) throw toOdontogramError(error)
}

/**
 * Impide cambiar o borrar una línea que ya tiene un movimiento de caja.
 * El vínculo es la garantía contra el doble cobro; corregirlo se hace desde la
 * caja, no desde el odontograma.
 */
async function assertItemNotBilled(itemId: string): Promise<void> {
  const { data, error } = await supabase
    .from('odontogram_items')
    .select('patient_treatment_id')
    .eq('id', itemId)
    .maybeSingle()

  if (error) throw toOdontogramError(error)

  if ((data as { patient_treatment_id: string | null } | null)?.patient_treatment_id) {
    throw new Error(
      'Esta línea ya tiene un cobro en caja. Para cambiarla o quitarla, ajustá el movimiento desde Caja.',
    )
  }
}

/** Enlace entre una línea del odontograma y el tratamiento creado en caja. */
export type BilledItemLink = {
  itemId: string
  patientTreatmentId: string
}

/**
 * Marca como cobradas las líneas que acaban de pasar por caja:
 * `status = completed`, `performed_at` y el vínculo con `patient_treatments`.
 *
 * Se llama **después** de `registerTreatmentCharge`. La condición
 * `patient_treatment_id is null` evita pisar un cobro hecho en otra pestaña; si
 * algo falla, quien llama recarga el odontograma y las líneas ya enlazadas
 * dejan de ser cobrables.
 */
export async function markOdontogramItemsBilled(
  links: BilledItemLink[],
): Promise<OdontogramItem[]> {
  if (links.length === 0) return []

  const performedAt = new Date().toISOString()
  const updated: OdontogramItem[] = []

  for (const link of links) {
    const { data, error } = await supabase
      .from('odontogram_items')
      .update({
        status: 'completed' satisfies OdontogramItemStatus,
        performed_at: performedAt,
        patient_treatment_id: link.patientTreatmentId,
      })
      .eq('id', link.itemId)
      .is('patient_treatment_id', null)
      .select(ODONTOGRAM_ITEM_SELECT)
      .maybeSingle()

    if (error) throw toOdontogramError(error)

    if (!data) {
      throw new Error(
        'No pudimos enlazar una pieza con su cobro: la línea ya no existe o ya estaba cobrada. Recargá el odontograma.',
      )
    }

    updated.push(normalizeItem(data as unknown as RawItem))
  }

  return updated
}
