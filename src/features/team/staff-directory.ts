import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

/**
 * Directorio del personal activo del consultorio.
 *
 * Lee la vista `public.staff_directory` (migración
 * `20261110100000_waiting_room_display.sql`), que expone únicamente `id`,
 * `full_name` y `role`. Sirve para dos cosas concretas:
 *
 * - el selector de profesional del formulario de citas (cualquier rol agenda);
 * - el «Profesional» de la pantalla de sala (`/tv`).
 *
 * `public.profiles` completo (con email y estado de acceso) sigue siendo solo
 * para administración: `TeamPage` es la única pantalla que lo lee.
 */

const STAFF_DIRECTORY_SELECT = 'id, full_name, role'

/** El equipo de un consultorio es chico; el límite solo evita traer de más. */
const STAFF_DIRECTORY_LIMIT = 200

export type StaffDirectoryEntry = {
  id: string
  full_name: string
  role: string
}

/** `dentist_id` → nombre visible. */
export type StaffNameMap = Record<string, string>

export function toStaffNameMap(entries: StaffDirectoryEntry[]): StaffNameMap {
  const map: StaffNameMap = {}

  for (const entry of entries) map[entry.id] = entry.full_name

  return map
}

/** Nombre del profesional a partir del id, con `null` si no está en el mapa. */
export function getStaffName(map: StaffNameMap, id: string | null): string | null {
  if (!id) return null

  return map[id] ?? null
}

/** PostgREST responde `42P01`/`PGRST205` cuando la vista todavía no existe. */
function isMissingView(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true

  return /staff_directory/i.test(error.message ?? '') && /not (found|exist)/i.test(error.message ?? '')
}

export async function fetchStaffDirectory(): Promise<StaffDirectoryEntry[]> {
  const { data, error } = await supabase
    .from('staff_directory')
    .select(STAFF_DIRECTORY_SELECT)
    .order('full_name', { ascending: true })
    .limit(STAFF_DIRECTORY_LIMIT)

  if (error) {
    // Sin la vista el resto de la agenda sigue funcionando: el campo profesional
    // es opcional, así que se devuelve una lista vacía.
    if (isMissingView(error)) return []

    throw new Error(
      'No se pudo cargar el directorio del equipo. Verificá la conexión y volvé a intentar.',
    )
  }

  return (data ?? []) as StaffDirectoryEntry[]
}

/** Directorio para el formulario de citas (carga al abrir el modal). */
export function useStaffDirectory() {
  const [members, setMembers] = useState<StaffDirectoryEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let isCurrent = true

    fetchStaffDirectory()
      .then((entries) => {
        if (!isCurrent) return

        setMembers(entries)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return

        setError(
          cause instanceof Error
            ? cause.message
            : 'No se pudo cargar el directorio del equipo.',
        )
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false)
      })

    return () => {
      isCurrent = false
    }
  }, [reloadToken])

  const reload = useCallback(() => {
    setIsLoading(true)
    setReloadToken((token) => token + 1)
  }, [])

  return { members, isLoading, error, reload }
}
