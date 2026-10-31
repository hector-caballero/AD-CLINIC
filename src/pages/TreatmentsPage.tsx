import { useMemo, useState } from 'react'
import {
  AlertCircle,
  Clock,
  Layers,
  Loader2,
  RefreshCw,
  SearchX,
  Stethoscope,
  Tags,
  X,
} from 'lucide-react'
import { formatPYG } from '../lib/format'
import { TreatmentFormModal } from '../features/treatments/TreatmentFormModal'
import { TreatmentsTable } from '../features/treatments/TreatmentsTable'
import { TreatmentsToolbar } from '../features/treatments/TreatmentsToolbar'
import { formatDuration } from '../features/treatments/treatment-format'
import {
  buildCategoryFilters,
  computeTreatmentSummary,
  countTreatmentsByStatus,
  filterTreatments,
  getCategoryLabel,
  groupTreatmentsByCategory,
  type Treatment,
  type TreatmentStatusFilter,
} from '../features/treatments/treatment-types'
import { setTreatmentActive } from '../features/treatments/treatments-service'
import { useTreatments } from '../features/treatments/useTreatments'

type FormState = { mode: 'create' } | { mode: 'edit'; treatment: Treatment } | null

const PRIMARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700'

const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50'

function SummaryCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string
  value: string
  detail: string
  icon: typeof Stethoscope
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-slate-500">
        <Icon className="size-4" aria-hidden="true" />
        <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
        {value}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{detail}</p>
    </div>
  )
}

export default function TreatmentsPage() {
  const { treatments, isLoading, isTruncated, error, reload, addTreatment, replaceTreatment } =
    useTreatments()

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<TreatmentStatusFilter>('all')
  const [category, setCategory] = useState<string>('all')
  const [formState, setFormState] = useState<FormState>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const summary = useMemo(() => computeTreatmentSummary(treatments), [treatments])
  const statusCounts = useMemo(() => countTreatmentsByStatus(treatments), [treatments])
  const categoryFilters = useMemo(() => buildCategoryFilters(treatments), [treatments])

  const visibleTreatments = useMemo(
    () => filterTreatments(treatments, { query, category, status }),
    [treatments, query, category, status],
  )

  const groups = useMemo(
    () => groupTreatmentsByCategory(visibleTreatments),
    [visibleTreatments],
  )

  const hasFilters = query.trim().length > 0 || status !== 'all' || category !== 'all'

  function clearFilters() {
    setQuery('')
    setStatus('all')
    setCategory('all')
  }

  function openCreate() {
    setNotice(null)
    setFormState({ mode: 'create' })
  }

  function openEdit(treatment: Treatment) {
    setNotice(null)
    setFormState({ mode: 'edit', treatment })
  }

  function closeForm() {
    setFormState(null)
  }

  function handleSaved(treatment: Treatment, mode: 'create' | 'edit') {
    if (mode === 'create') {
      addTreatment(treatment)
      setNotice(`Se agregó ${treatment.name} al catálogo.`)
    } else {
      replaceTreatment(treatment)
      setNotice(`Se actualizó ${treatment.name}.`)
    }

    setFormState(null)
  }

  async function handleToggleActive(treatment: Treatment) {
    if (pendingId) return

    setPendingId(treatment.id)
    setNotice(null)

    try {
      const updated = await setTreatmentActive(treatment.id, !treatment.is_active)
      replaceTreatment(updated)
      setNotice(
        updated.is_active
          ? `${updated.name} vuelve a estar disponible para cobrar.`
          : `${updated.name} se desactivó y ya no aparece en el cobro.`,
      )
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : 'No se pudo cambiar el estado del tratamiento. Intentá de nuevo.',
      )
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Tratamientos"
          value={String(summary.total)}
          detail={`${summary.active} activos para cobrar`}
          icon={Stethoscope}
        />
        <SummaryCard
          label="Categorías"
          value={String(summary.categories)}
          detail="Especialidades presentes en el catálogo"
          icon={Layers}
        />
        <SummaryCard
          label="Precio promedio"
          value={formatPYG(summary.averagePrice)}
          detail="Calculado sobre los tratamientos activos"
          icon={Tags}
        />
        <SummaryCard
          label="Duración promedio"
          value={formatDuration(summary.averageDuration)}
          detail="Tiempo de sillón por sesión"
          icon={Clock}
        />
      </div>

      <section
        aria-label="Catálogo de tratamientos"
        aria-busy={isLoading}
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      >
        <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
          <TreatmentsToolbar
            query={query}
            status={status}
            category={category}
            statusCounts={statusCounts}
            categoryFilters={categoryFilters}
            onQueryChange={setQuery}
            onStatusChange={setStatus}
            onCategoryChange={setCategory}
            onCreate={openCreate}
          />
        </div>

        {notice && (
          <div
            role="status"
            className="flex items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800 sm:px-5"
          >
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Ocultar aviso"
              className="rounded-md p-1 text-emerald-700 transition-colors hover:bg-emerald-100"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {isTruncated && !error && (
          <div className="border-b border-amber-100 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 sm:px-5">
            Se muestran los primeros {treatments.length} tratamientos del catálogo. Usá el buscador
            para encontrar uno puntual.
          </div>
        )}
        {error ? (
          <div role="alert" className="flex flex-col items-center px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
              <AlertCircle className="size-7" aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-sm font-semibold text-slate-900">
              No pudimos cargar el catálogo
            </h2>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-500">{error}</p>
            <button type="button" onClick={reload} className={`mt-5 ${PRIMARY_BUTTON_CLASS}`}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Reintentar
            </button>
          </div>
        ) : isLoading ? (
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-3 px-6 py-20 text-center"
          >
            <Loader2 className="size-6 animate-spin text-brand-600" aria-hidden="true" />
            <p className="text-sm text-slate-500">Cargando catálogo…</p>
          </div>
        ) : (
          <>
            {groups.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-16 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                  <SearchX className="size-7" aria-hidden="true" />
                </span>
                <h2 className="mt-4 text-sm font-semibold text-slate-900">
                  {hasFilters ? 'Sin resultados para estos filtros' : 'Todavía no hay tratamientos'}
                </h2>
                <p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
                  {hasFilters
                    ? `No encontramos tratamientos${
                        category !== 'all' ? ` en ${getCategoryLabel(category)}` : ''
                      } con ese criterio. Probá con otro nombre, código o categoría.`
                    : 'Cargá el primer tratamiento con su precio en guaraníes y duración para poder cobrarlo en recepción.'}
                </p>
                {hasFilters ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className={`mt-5 ${SECONDARY_BUTTON_CLASS}`}
                  >
                    Limpiar filtros
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={openCreate}
                    className={`mt-5 ${PRIMARY_BUTTON_CLASS}`}
                  >
                    <Stethoscope className="size-4" aria-hidden="true" />
                    Nuevo tratamiento
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500 sm:px-5">
                  <span>
                    Mostrando{' '}
                    <span className="font-semibold text-slate-700">
                      {visibleTreatments.length}
                    </span>{' '}
                    de {treatments.length} tratamientos
                  </span>
                  {hasFilters && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="font-medium text-brand-700 transition-colors hover:text-brand-800 hover:underline"
                    >
                      Limpiar filtros
                    </button>
                  )}
                </div>

                <TreatmentsTable
                  groups={groups}
                  pendingId={pendingId}
                  onEdit={openEdit}
                  onToggleActive={handleToggleActive}
                />
              </>
            )}
          </>

        )}
      </section>

      <p className="text-xs leading-relaxed text-slate-400">
        Los tratamientos no se eliminan: al desactivarlos dejan de ofrecerse en el cobro pero se
        conservan en las fichas y en el historial de pagos.
      </p>

      {formState && (
        <TreatmentFormModal
          key={formState.mode === 'edit' ? formState.treatment.id : 'new-treatment'}
          treatment={formState.mode === 'edit' ? formState.treatment : null}
          onClose={closeForm}
          onSaved={handleSaved}
        />
      )}

    </div>
  )
}
