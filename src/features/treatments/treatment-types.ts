/**
 * Tipos y utilidades del catálogo de tratamientos (`public.treatments`).
 *
 * Reglas del módulo:
 * - `code` es único y se guarda en mayúsculas (`PRO-001`).
 * - `category` es texto libre en la base; la UI propone una lista fija de
 *   especialidades y ordena por ella.
 * - `default_price` está en guaraníes (sin centavos) y
 *   `default_duration_minutes` entre 5 y 600.
 * - Nunca se elimina un tratamiento: se desactiva (`is_active = false`) para no
 *   romper `patient_treatments`, que lo referencia con `on delete restrict`.
 */

export type Treatment = {
  id: string
  code: string
  name: string
  category: string
  description: string | null
  default_price: number
  default_duration_minutes: number
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Payload de alta/edición (lo que viaja a Supabase). */
export type TreatmentInput = {
  code: string
  name: string
  category: string
  description: string | null
  default_price: number
  default_duration_minutes: number
  is_active: boolean
}

/** Valores del formulario: todo texto, porque los inputs no manejan `null`. */
export type TreatmentFormValues = {
  code: string
  name: string
  category: string
  description: string
  /** Monto con separador de miles (`150.000`), sin símbolo. */
  price: string
  /** Duración en minutos como texto. */
  duration: string
  is_active: boolean
}

export type TreatmentStatusFilter = 'all' | 'active' | 'inactive'

export type TreatmentFilters = {
  query: string
  category: string
  status: TreatmentStatusFilter
}

export type TreatmentCategoryGroup = {
  category: string
  label: string
  treatments: Treatment[]
}

export type TreatmentCategoryFilter = {
  value: string
  label: string
  count: number
}

export type TreatmentSummary = {
  total: number
  active: number
  categories: number
  averagePrice: number
  averageDuration: number
}

export const TREATMENT_SELECT = [
  'id',
  'code',
  'name',
  'category',
  'description',
  'default_price',
  'default_duration_minutes',
  'is_active',
  'created_at',
  'updated_at',
].join(', ')

/** Orden en el que se agrupa el catálogo (el mismo del formulario). */
export const TREATMENT_CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: 'prevención', label: 'Prevención' },
  { value: 'operatoria', label: 'Operatoria' },
  { value: 'endodoncia', label: 'Endodoncia' },
  { value: 'periodoncia', label: 'Periodoncia' },
  { value: 'cirugía', label: 'Cirugía' },
  { value: 'prótesis', label: 'Prótesis' },
  { value: 'ortodoncia', label: 'Ortodoncia' },
  { value: 'estética', label: 'Estética' },
  { value: 'imagen', label: 'Imagen' },
  { value: 'general', label: 'General' },
]

export const TREATMENT_STATUS_FILTERS: { value: TreatmentStatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
]

const CATEGORY_RANK = new Map(
  TREATMENT_CATEGORY_OPTIONS.map((option, index) => [option.value.toLocaleLowerCase('es'), index]),
)

/** Minúsculas y sin diacríticos, para comparar/buscar sin importar tildes. */
export function normalizeSearchTerm(value: string): string {
  return value
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

/** Etiqueta legible de una categoría libre (`operatoria` → `Operatoria`). */
export function getCategoryLabel(category: string | null | undefined): string {
  const raw = (category ?? '').trim()

  if (!raw) return 'Sin categoría'

  const known = TREATMENT_CATEGORY_OPTIONS.find(
    (option) => normalizeSearchTerm(option.value) === normalizeSearchTerm(raw),
  )

  if (known) return known.label

  return raw.charAt(0).toUpperCase() + raw.slice(1)
}

function getCategoryRank(category: string): number {
  return CATEGORY_RANK.get(category.toLocaleLowerCase('es')) ?? TREATMENT_CATEGORY_OPTIONS.length
}

/** Código interno en mayúsculas, sin espacios ni símbolos raros. */
export function normalizeTreatmentCode(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9-]/g, '')
    .toUpperCase()
    .slice(0, 20)
}

/** Orden del catálogo: categoría conocida, luego nombre y por último código. */
export function compareTreatments(a: Treatment, b: Treatment): number {
  const byRank = getCategoryRank(a.category) - getCategoryRank(b.category)

  if (byRank !== 0) return byRank

  const byCategory = a.category.localeCompare(b.category, 'es', { sensitivity: 'base' })

  if (byCategory !== 0) return byCategory

  const byName = a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })

  if (byName !== 0) return byName

  return a.code.localeCompare(b.code, 'es', { sensitivity: 'base' })
}

/** Filtro combinado de la barra de herramientas (búsqueda + categoría + estado). */
export function filterTreatments(
  treatments: Treatment[],
  { query, category, status }: TreatmentFilters,
): Treatment[] {
  const term = normalizeSearchTerm(query)

  return treatments.filter((treatment) => {
    if (status === 'active' && !treatment.is_active) return false
    if (status === 'inactive' && treatment.is_active) return false
    if (category !== 'all' && treatment.category !== category) return false
    if (!term) return true

    const haystack = normalizeSearchTerm(
      [treatment.code, treatment.name, treatment.category, treatment.description ?? ''].join(' '),
    )

    return haystack.includes(term)
  })
}

/** Agrupa por categoría respetando el orden clínico de `TREATMENT_CATEGORY_OPTIONS`. */
export function groupTreatmentsByCategory(treatments: Treatment[]): TreatmentCategoryGroup[] {
  const groups = new Map<string, Treatment[]>()

  for (const treatment of [...treatments].sort(compareTreatments)) {
    const current = groups.get(treatment.category)

    if (current) {
      current.push(treatment)
    } else {
      groups.set(treatment.category, [treatment])
    }
  }

  return [...groups.entries()].map(([category, items]) => ({
    category,
    label: getCategoryLabel(category),
    treatments: items,
  }))
}

/** Chips de categoría con la cantidad de tratamientos de cada una. */
export function buildCategoryFilters(treatments: Treatment[]): TreatmentCategoryFilter[] {
  const counts = new Map<string, number>()

  for (const treatment of treatments) {
    counts.set(treatment.category, (counts.get(treatment.category) ?? 0) + 1)
  }

  return [
    { value: 'all', label: 'Todas', count: treatments.length },
    ...[...counts.entries()]
      .sort(([categoryA], [categoryB]) => {
        const byRank = getCategoryRank(categoryA) - getCategoryRank(categoryB)

        if (byRank !== 0) return byRank

        return categoryA.localeCompare(categoryB, 'es', { sensitivity: 'base' })
      })
      .map(([category, count]) => ({
        value: category,
        label: getCategoryLabel(category),
        count,
      })),
  ]
}

export function countTreatmentsByStatus(
  treatments: Treatment[],
): Record<TreatmentStatusFilter, number> {
  const active = treatments.filter((treatment) => treatment.is_active).length

  return {
    all: treatments.length,
    active,
    inactive: treatments.length - active,
  }
}

/** Métricas de las tarjetas de resumen (promedios calculados sobre los activos). */
export function computeTreatmentSummary(treatments: Treatment[]): TreatmentSummary {
  const active = treatments.filter((treatment) => treatment.is_active)
  const totalPrice = active.reduce((sum, treatment) => sum + treatment.default_price, 0)
  const totalDuration = active.reduce(
    (sum, treatment) => sum + treatment.default_duration_minutes,
    0,
  )

  return {
    total: treatments.length,
    active: active.length,
    categories: new Set(treatments.map((treatment) => treatment.category)).size,
    averagePrice: active.length > 0 ? Math.round(totalPrice / active.length) : 0,
    averageDuration: active.length > 0 ? Math.round(totalDuration / active.length) : 0,
  }
}

