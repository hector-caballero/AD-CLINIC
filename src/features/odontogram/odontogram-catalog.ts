import {
  TREATMENT_CATEGORY_OPTIONS,
  getCategoryLabel,
  normalizeSearchTerm,
  type Treatment,
} from '../treatments/treatment-types'

/**
 * Catálogo de tratamientos para el odontograma.
 *
 * Se consulta `public.treatments` a través de `useTreatments()` y acá solo se
 * filtra/agrupa en memoria: el catálogo de la clínica es corto y así el
 * buscador responde en cada tecla. Los precios están en guaraníes (PYG).
 */

export type TreatmentOption = Pick<
  Treatment,
  'id' | 'code' | 'name' | 'category' | 'default_price' | 'default_duration_minutes'
>

export type TreatmentOptionGroup = {
  category: string
  label: string
  items: TreatmentOption[]
}

const CATEGORY_RANK = new Map(
  TREATMENT_CATEGORY_OPTIONS.map((option, index) => [normalizeSearchTerm(option.value), index]),
)

/** PostgREST puede devolver `numeric` como texto: se normaliza antes de formatear. */
function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(parsed) ? parsed : 0
}

function toOption(treatment: Treatment): TreatmentOption {
  return {
    id: treatment.id,
    code: treatment.code,
    name: treatment.name,
    category: treatment.category,
    default_price: Math.round(toNumber(treatment.default_price)),
    default_duration_minutes: toNumber(treatment.default_duration_minutes),
  }
}

/** Solo tratamientos activos; filtra por código, nombre o categoría. */
export function filterTreatmentOptions(
  treatments: Treatment[],
  query: string,
): TreatmentOption[] {
  const term = normalizeSearchTerm(query)

  return treatments
    .filter((treatment) => treatment.is_active)
    .filter((treatment) => {
      if (!term) return true

      return normalizeSearchTerm(
        `${treatment.code} ${treatment.name} ${treatment.category}`,
      ).includes(term)
    })
    .map(toOption)
}

/** Agrupa por especialidad respetando el orden clínico del catálogo. */
export function groupTreatmentOptions(options: TreatmentOption[]): TreatmentOptionGroup[] {
  const groups = new Map<string, TreatmentOption[]>()

  for (const option of options) {
    const category = option.category?.trim() || 'general'
    const bucket = groups.get(category)

    if (bucket) bucket.push(option)
    else groups.set(category, [option])
  }

  return [...groups.entries()]
    .sort(([categoryA], [categoryB]) => {
      const rankA = CATEGORY_RANK.get(normalizeSearchTerm(categoryA)) ?? CATEGORY_RANK.size
      const rankB = CATEGORY_RANK.get(normalizeSearchTerm(categoryB)) ?? CATEGORY_RANK.size

      if (rankA !== rankB) return rankA - rankB

      return categoryA.localeCompare(categoryB, 'es', { sensitivity: 'base' })
    })
    .map(([category, items]) => ({
      category,
      label: getCategoryLabel(category),
      items: [...items].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })),
    }))
}
