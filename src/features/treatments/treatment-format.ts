/**
 * Formato de precios y duraciones del catálogo.
 *
 * Los importes están en guaraníes (sin centavos) y se muestran con `formatPYG`.
 * La duración se expresa en minutos en la base y se presenta como `40 min` o
 * `1 h 30 min` para que se lea rápido en la tabla.
 */

/** `40` → `40 min`; `90` → `1 h 30 min`; `120` → `2 h`. */
export function formatDuration(minutes: number | null | undefined): string {
  const safe = Number.isFinite(minutes) ? Math.round(minutes as number) : 0

  if (safe <= 0) return '—'
  if (safe < 60) return `${safe} min`

  const hours = Math.floor(safe / 60)
  const rest = safe % 60

  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/** Duración corta para tablas y chips: `1:30 h` se evita a favor de `90 min`. */
export function formatDurationCompact(minutes: number | null | undefined): string {
  const safe = Number.isFinite(minutes) ? Math.round(minutes as number) : 0

  return safe > 0 ? `${safe} min` : '—'
}
