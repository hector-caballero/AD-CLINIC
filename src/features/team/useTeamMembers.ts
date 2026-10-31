import { useCallback, useEffect, useState } from 'react'
import { fetchTeamMembers } from './team-service'
import { compareTeamMembers, type TeamMember } from './team-types'

/**
 * Estado del equipo del consultorio.
 *
 * Mantiene la lista en memoria y la actualiza con las respuestas de la Edge
 * Function, sin volver a pedir todo después de cada cambio.
 */
export function useTeamMembers() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let isCurrent = true

    fetchTeamMembers()
      .then((data) => {
        if (!isCurrent) return

        setMembers(data)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return

        setError(
          cause instanceof Error ? cause.message : 'No se pudo cargar el equipo del consultorio.',
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

  const addMember = useCallback((member: TeamMember) => {
    setMembers((current) => [...current, member].sort(compareTeamMembers))
  }, [])

  const replaceMember = useCallback((member: TeamMember) => {
    setMembers((current) =>
      current.map((item) => (item.id === member.id ? member : item)).sort(compareTeamMembers),
    )
  }, [])

  return { members, isLoading, error, reload, addMember, replaceMember }
}
