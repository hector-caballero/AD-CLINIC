/**
 * Avisos de cambios hechos por el copiloto clínico.
 *
 * El asistente vive en `AppLayout`, no dentro de las pantallas, así que cuando
 * escribe en la base (un hallazgo del odontograma, una cita, un cobro) la página
 * que está abierta tiene que enterarse para refrescar sus datos. Se usa un
 * evento de `window` en lugar de un estado global: las páginas se suscriben solo
 * al módulo que les corresponde y no hay que pasar props por todo el árbol.
 *
 * `patientId` (`null` = cualquier paciente) permite filtrar en pantallas que
 * muestran a una sola persona, como el odontograma.
 *
 * Hoy lo disparan las acciones del copiloto que escriben en la base: llamar al
 * siguiente paciente y agendar un control (`appointments`) y guardar un hallazgo
 * en el odontograma (`odontogram`). Los cobros y las facturas los confirma el
 * doctor en el modal de la pantalla, que refresca sus propios datos; los demás
 * ámbitos quedan reservados por si el copiloto suma escrituras.
 */

export const ASSISTANT_DATA_EVENT = 'ad-clinic:assistant-data'

export type AssistantDataScope =
  | 'patients'
  | 'appointments'
  | 'odontogram'
  | 'cash'
  | 'invoicing'

export type AssistantDataChange = {
  scope: AssistantDataScope
  /** Paciente al que pertenece el cambio (`null` = todos). */
  patientId: string | null
}

/** Avisa a las pantallas abiertas que el asistente modificó datos. */
export function notifyAssistantDataChange(change: AssistantDataChange): void {
  if (typeof window === 'undefined') return

  window.dispatchEvent(
    new CustomEvent<AssistantDataChange>(ASSISTANT_DATA_EVENT, { detail: change }),
  )
}

/** Suscripción para las páginas; devuelve la función de baja para el cleanup. */
export function subscribeAssistantDataChanges(
  handler: (change: AssistantDataChange) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<AssistantDataChange>).detail

    if (detail) handler(detail)
  }

  window.addEventListener(ASSISTANT_DATA_EVENT, listener)

  return () => window.removeEventListener(ASSISTANT_DATA_EVENT, listener)
}

/** `true` si el cambio afecta a la pantalla (mismo paciente o cambio global). */
export function affectsPatient(change: AssistantDataChange, patientId: string | null): boolean {
  if (!change.patientId) return true

  return change.patientId === patientId
}
