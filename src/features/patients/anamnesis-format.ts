/**
 * Formato de la anamnesis para mostrar en pantalla.
 *
 * Las fechas de la ficha llegan como `timestamptz` (`2026-11-04T17:32:10.123+00:00`),
 * a diferencia de las fechas clínicas que son `date` y se muestran con
 * `formatShortDate()`. Acá se usa `Intl` en hora local del consultorio.
 */

/** Fecha y hora local de un `timestamptz` de la ficha (`updated_at`, `consent_signed_at`). */
export function formatHistoryDateTime(value: string | null | undefined): string {
  if (!value) return '—'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('es-PY', {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date)
}

/** Fecha de firma del consentimiento informado. */
export function formatConsentSignedAt(value: string | null | undefined): string {
  if (!value) return 'Pendiente de firma'

  const formatted = formatHistoryDateTime(value)

  return formatted === '—' ? 'Pendiente de firma' : formatted
}
