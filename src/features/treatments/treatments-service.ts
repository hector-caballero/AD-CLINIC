import { supabase } from '../../lib/supabase'
import { toTreatmentError } from './treatment-errors'
import { TREATMENT_SELECT, type Treatment, type TreatmentInput } from './treatment-types'

/**
 * Acceso a `public.treatments` (catálogo de la clínica).
 *
 * - El catálogo se carga completo: es una tabla corta (decenas de filas) y así
 *   la búsqueda, el agrupado y los contadores son instantáneos en el cliente.
 * - No hay borrado: `patient_treatments` referencia el tratamiento con
 *   `on delete restrict`, así que se desactiva en su lugar.
 */

/** Coincide con el límite por defecto de PostgREST (`db-max-rows`). */
export const TREATMENTS_PAGE_SIZE = 1000

/**
 * El cliente de `src/lib/supabase.ts` se crea sin la interfaz generada
 * `Database`, así que PostgREST no puede inferir la forma de la fila con un
 * `select` dinámico. Estas conversiones documentan el contrato real.
 */
function asTreatments(data: unknown): Treatment[] {
  return (data ?? []) as Treatment[]
}

function asTreatment(data: unknown): Treatment {
  return data as Treatment
}

export type TreatmentsSnapshot = {
  treatments: Treatment[]
  /** `true` cuando se alcanzó el límite y puede haber más tratamientos. */
  isTruncated: boolean
}

export async function fetchTreatments(): Promise<TreatmentsSnapshot> {
  const { data, error } = await supabase
    .from('treatments')
    .select(TREATMENT_SELECT)
    .order('category', { ascending: true })
    .order('name', { ascending: true })
    .limit(TREATMENTS_PAGE_SIZE)

  if (error) throw toTreatmentError(error)

  const treatments = asTreatments(data)

  return { treatments, isTruncated: treatments.length >= TREATMENTS_PAGE_SIZE }
}

export async function createTreatment(input: TreatmentInput): Promise<Treatment> {
  const { data, error } = await supabase
    .from('treatments')
    .insert(input)
    .select(TREATMENT_SELECT)
    .single()

  if (error) throw toTreatmentError(error)
  if (!data) throw new Error('Supabase no devolvió el tratamiento creado. Recargá el catálogo.')

  return asTreatment(data)
}

export async function updateTreatment(id: string, input: TreatmentInput): Promise<Treatment> {
  const { data, error } = await supabase
    .from('treatments')
    .update(input)
    .eq('id', id)
    .select(TREATMENT_SELECT)
    .single()

  if (error) throw toTreatmentError(error)
  if (!data) throw new Error('El tratamiento ya no existe. Recargá el catálogo.')

  return asTreatment(data)
}

/**
 * Activa o desactiva un tratamiento.
 * Los inactivos desaparecen del modal de cobro (`useTreatmentsCatalog` filtra
 * por `is_active`) pero se conservan para el historial de los pacientes.
 */
export async function setTreatmentActive(id: string, isActive: boolean): Promise<Treatment> {
  const { data, error } = await supabase
    .from('treatments')
    .update({ is_active: isActive })
    .eq('id', id)
    .select(TREATMENT_SELECT)
    .single()

  if (error) throw toTreatmentError(error)
  if (!data) throw new Error('El tratamiento ya no existe. Recargá el catálogo.')

  return asTreatment(data)
}
