import { supabase } from '../../lib/supabase'
import { toPatientError } from './patient-errors'
import {
  PATIENT_SELECT,
  type Patient,
  type PatientInput,
  type PatientStatus,
} from './patient-types'

/**
 * Acceso a `public.patients`.
 *
 * Reglas del módulo:
 * - Nunca se elimina una ficha: el borrado es lógico (`deleted_at`).
 * - Todas las consultas excluyen las fichas eliminadas.
 * - Los documentos y teléfonos se guardan normalizados (sin puntos ni guiones).
 */

/** Coincide con el límite por defecto de PostgREST (`db-max-rows`). */
export const PATIENTS_PAGE_SIZE = 1000

/**
 * El cliente de `src/lib/supabase.ts` se crea sin la interfaz generada
 * `Database`, así que PostgREST no puede inferir la forma de la fila cuando el
 * `select` es un string dinámico y devuelve `GenericStringError`. Estas
 * conversiones documentan el contrato real de `public.patients`.
 */
function asPatients(data: unknown): Patient[] {
  return (data ?? []) as Patient[]
}

function asPatient(data: unknown): Patient {
  return data as Patient
}

export type PatientsSnapshot = {
  patients: Patient[]
  /** `true` cuando se alcanzó el límite y puede haber más fichas. */
  isTruncated: boolean
}

export async function fetchPatients(): Promise<PatientsSnapshot> {
  const { data, error } = await supabase
    .from('patients')
    .select(PATIENT_SELECT)
    .is('deleted_at', null)
    .order('last_name', { ascending: true })
    .order('first_name', { ascending: true })
    .limit(PATIENTS_PAGE_SIZE)

  if (error) throw toPatientError(error)

  const patients = asPatients(data)

  return { patients, isTruncated: patients.length >= PATIENTS_PAGE_SIZE }
}

export async function createPatient(input: PatientInput): Promise<Patient> {
  const { data, error } = await supabase
    .from('patients')
    .insert(input)
    .select(PATIENT_SELECT)
    .single()

  if (error) throw toPatientError(error)
  if (!data) throw new Error('Supabase no devolvió la ficha creada. Recargá el listado.')

  return asPatient(data)
}

export async function updatePatient(id: string, input: PatientInput): Promise<Patient> {
  const { data, error } = await supabase
    .from('patients')
    .update(input)
    .eq('id', id)
    .is('deleted_at', null)
    .select(PATIENT_SELECT)
    .single()

  if (error) throw toPatientError(error)
  if (!data) throw new Error('La ficha ya no existe o fue eliminada por otra persona.')

  return asPatient(data)
}

/** Borrado lógico: conserva la historia clínica y las referencias de citas/cobros. */
export async function softDeletePatient(id: string): Promise<void> {
  const { error } = await supabase
    .from('patients')
    .update({ deleted_at: new Date().toISOString(), status: 'inactive' satisfies PatientStatus })
    .eq('id', id)
    .is('deleted_at', null)

  if (error) throw toPatientError(error)
}

/** Revierte un borrado lógico (útil para deshacer desde soporte). */
export async function restorePatient(id: string): Promise<void> {
  const { error } = await supabase
    .from('patients')
    .update({ deleted_at: null, status: 'active' satisfies PatientStatus })
    .eq('id', id)

  if (error) throw toPatientError(error)
}
