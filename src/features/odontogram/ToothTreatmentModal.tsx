import { useMemo, useState, type FormEvent } from 'react'
import { AlertCircle, Loader2, Search } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { formatPYG, formatPYGInput, parsePYGInput } from '../../lib/format'
import { formatDuration } from '../treatments/treatment-format'
import { useTreatments } from '../treatments/useTreatments'
import {
  filterTreatmentOptions,
  groupTreatmentOptions,
  type TreatmentOption,
} from './odontogram-catalog'
import { getToothName } from './odontogram-teeth'
import {
  ITEM_STATUS_META,
  getSurfaceLabel,
  type OdontogramDraft,
  type OdontogramItem,
  type OdontogramItemStatus,
  type ToothSurface,
} from './odontogram-types'

const INPUT_CLASS =
  'w-full rounded-xl border border-slate-300 bg-white/85 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500'

const LABEL_CLASS = 'mb-1 block text-sm font-medium text-slate-700'

type ToothTreatmentModalProps = {
  patientName: string
  toothNumber: number
  /** `null` = pieza completa. */
  surface: ToothSurface | null
  /** Ítems del odontograma actual, para mostrar lo ya registrado en la pieza. */
  items: OdontogramItem[]
  initialStatus?: OdontogramItemStatus
  onClose: () => void
  onSubmit: (draft: OdontogramDraft) => Promise<unknown>
}

/**
 * Selector de procedimiento para una pieza o cara.
 *
 * El estado define el color del odontograma: pendiente (patología),
 * presupuestado o realizado. «Ausente» solo aplica a la pieza completa y no
 * lleva tratamiento ni precio.
 */
export function ToothTreatmentModal({
  patientName,
  toothNumber,
  surface,
  items,
  initialStatus = 'budgeted',
  onClose,
  onSubmit,
}: ToothTreatmentModalProps) {
  const existingItem =
    items.find(
      (item) =>
        item.tooth_number === toothNumber && item.surface === surface && item.status !== 'absent',
    ) ?? null
  const toothItems = items.filter((item) => item.tooth_number === toothNumber)
  const absentItem = toothItems.find((item) => item.status === 'absent') ?? null

  const [status, setStatus] = useState<OdontogramItemStatus>(
    absentItem ? 'absent' : (existingItem?.status ?? initialStatus),
  )
  const [treatmentId, setTreatmentId] = useState(existingItem?.treatment_id ?? '')
  const [query, setQuery] = useState('')
  const [quantity, setQuantity] = useState(existingItem?.quantity ?? 1)
  const [priceInput, setPriceInput] = useState(
    existingItem ? formatPYGInput(String(Math.round(existingItem.unit_price))) : '',
  )
  const [notes, setNotes] = useState(existingItem?.notes ?? '')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { treatments, isLoading: isLoadingCatalog, error: catalogError, reload } = useTreatments()

  const options = useMemo(() => filterTreatmentOptions(treatments, query), [treatments, query])
  const groups = useMemo(() => groupTreatmentOptions(options), [options])

  const isAbsent = status === 'absent'
  const unitPrice = parsePYGInput(priceInput)
  const total = isAbsent ? 0 : Math.max(1, quantity) * unitPrice
  const statusChoices: OdontogramItemStatus[] = surface === null
    ? ['pending', 'budgeted', 'completed', 'absent']
    : ['pending', 'budgeted', 'completed']

  function chooseTreatment(option: TreatmentOption) {
    setTreatmentId(option.id)
    setPriceInput(formatPYGInput(String(option.default_price)))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isSaving) return
    if (isAbsent && absentItem) {
      setError('Esta pieza ya está marcada como ausente. Quitá la marca desde el presupuesto.')
      return
    }

    if (!isAbsent && !treatmentId) {
      setError('Elegí el tratamiento del catálogo.')
      return
    }

    if (!isAbsent && unitPrice <= 0) {
      setError('Ingresá el precio del procedimiento en guaraníes.')
      return
    }

    setError(null)
    setIsSaving(true)

    try {
      await onSubmit({
        toothNumber,
        surface: isAbsent ? null : surface,
        status,
        treatmentId: isAbsent ? null : treatmentId,
        quantity: isAbsent ? 1 : Math.max(1, Math.round(quantity)),
        unitPrice: isAbsent ? 0 : unitPrice,
        notes: notes.trim() || null,
      })

      onClose()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo guardar el procedimiento en la pieza.',
      )
      setIsSaving(false)
    }
  }

  return (
    <Modal
      title={`Pieza ${toothNumber} · ${getSurfaceLabel(surface)}`}
      description={`${getToothName(toothNumber)} · ${patientName}`}
      size="lg"
      onClose={onClose}
      isBusy={isSaving}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white/85 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="tooth-treatment-form"
            disabled={isSaving || (isAbsent && Boolean(absentItem))}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSaving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {isSaving ? 'Guardando…' : isAbsent ? 'Marcar pieza ausente' : 'Guardar en la pieza'}
          </button>
        </div>
      }
    >
      <form id="tooth-treatment-form" onSubmit={handleSubmit} className="space-y-4">
        <input type="hidden" name="tooth" value={toothNumber} />

        <fieldset>
          <legend className={LABEL_CLASS}>Estado clínico</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {statusChoices.map((choice) => {
              const meta = ITEM_STATUS_META[choice]
              const isActive = status === choice

              return (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setStatus(choice)}
                  aria-pressed={isActive}
                  className={[
                    'flex items-start gap-2 rounded-xl border px-3 py-2 text-left transition-colors',
                    isActive
                      ? 'border-brand-500 bg-brand-50/60 ring-1 ring-brand-200'
                      : 'border-slate-200/80 bg-white/85 hover:bg-slate-50',
                  ].join(' ')}
                >
                  <span
                    className={`mt-1 size-2.5 shrink-0 rounded-full ${meta.dot}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900">{meta.label}</span>
                    <span className="block text-[11px] leading-snug text-slate-500">
                      {meta.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </fieldset>

        {toothItems.length > 0 && (
          <div className="rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Ya registrado en la pieza
            </p>
            <ul className="mt-1.5 space-y-1">
              {toothItems.map((item) => {
                const meta = ITEM_STATUS_META[item.status]

                return (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-2 text-xs text-slate-600"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={`size-2 shrink-0 rounded-full ${meta.dot}`}
                        aria-hidden="true"
                      />
                      <span className="truncate">
                        {getSurfaceLabel(item.surface)} · {item.treatment?.name ?? 'Pieza ausente'}
                      </span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums text-slate-500">
                      {item.status === 'absent' ? meta.label : formatPYG(item.total_price)}
                    </span>
                  </li>
                )
              })}
            </ul>
            {existingItem && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                Guardar el mismo tratamiento actualiza la línea existente en lugar de duplicarla.
              </p>
            )}
          </div>
        )}

        {isAbsent ? (
          <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-sm leading-relaxed text-slate-600 ring-1 ring-slate-200">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden="true" />
            <p>
              {absentItem
                ? 'La pieza ya figura como ausente en este odontograma.'
                : 'La pieza se marca como ausente: no lleva tratamiento ni precio y se dibuja con una X. Si después se coloca un implante, quitá la marca y agregá el procedimiento.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="tooth-treatment-search" className={LABEL_CLASS}>
                Tratamiento del catálogo
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="tooth-treatment-search"
                  data-autofocus
                  type="text"
                  role="searchbox"
                  autoComplete="off"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar por nombre, código o especialidad…"
                  className={`${INPUT_CLASS} pl-9`}
                />
              </div>

              {catalogError ? (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
                  <span>{catalogError}</span>
                  <button type="button" onClick={reload} className="shrink-0 font-medium underline">
                    Reintentar
                  </button>
                </div>
              ) : (
                <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-slate-200">
                  {isLoadingCatalog ? (
                    <p className="flex items-center gap-2 px-3 py-4 text-sm text-slate-500">
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Cargando catálogo…
                    </p>
                  ) : groups.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-slate-500">
                      No encontramos tratamientos con esa búsqueda. Probá con otro nombre o código.
                    </p>
                  ) : (
                    groups.map((group) => (
                      <section key={group.category} aria-label={group.label}>
                        <h4 className="sticky top-0 z-10 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                          {group.label}
                        </h4>
                        <ul className="divide-y divide-slate-100">
                          {group.items.map((option) => {
                            const isSelected = treatmentId === option.id

                            return (
                              <li key={option.id}>
                                <button
                                  type="button"
                                  onClick={() => chooseTreatment(option)}
                                  aria-pressed={isSelected}
                                  className={[
                                    'flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors',
                                    isSelected ? 'bg-brand-50/70' : 'hover:bg-brand-50/40',
                                  ].join(' ')}
                                >
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm text-slate-900">
                                      {option.name}
                                    </span>
                                    <span className="block text-[11px] text-slate-500">
                                      {option.code} ·{' '}
                                      {formatDuration(option.default_duration_minutes)}
                                    </span>
                                  </span>
                                  <span className="shrink-0 text-sm font-medium tabular-nums text-slate-700">
                                    {formatPYG(option.default_price)}
                                  </span>
                                </button>
                              </li>
                            )
                          })}
                        </ul>
                      </section>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="tooth-quantity" className={LABEL_CLASS}>
                  Cantidad
                </label>
                <input
                  id="tooth-quantity"
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  value={quantity}
                  onChange={(event) =>
                    setQuantity(Math.max(1, Math.min(20, Number(event.target.value) || 1)))
                  }
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <label htmlFor="tooth-price" className={LABEL_CLASS}>
                  Precio unitario (₲)
                </label>
                <div className="relative">
                  <span
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400"
                    aria-hidden="true"
                  >
                    ₲
                  </span>
                  <input
                    id="tooth-price"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={priceInput}
                    onChange={(event) => setPriceInput(formatPYGInput(event.target.value))}
                    placeholder="150.000"
                    className={`${INPUT_CLASS} pl-8 tabular-nums`}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-brand-50 px-3 py-2.5 text-sm ring-1 ring-brand-100">
              <span className="font-medium text-brand-900">Total de la línea</span>
              <span className="font-semibold tabular-nums text-brand-900">{formatPYG(total)}</span>
            </div>

            <div>
              <label htmlFor="tooth-notes" className={LABEL_CLASS}>
                Observación clínica
              </label>
              <textarea
                id="tooth-notes"
                rows={2}
                maxLength={500}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Detalle opcional (movilidad, dolor, indicación…)"
                className={INPUT_CLASS}
              />
            </div>

            <p className="text-[11px] leading-relaxed text-slate-500">
              El precio se copia del catálogo en guaraníes y queda congelado en el presupuesto; se
              puede ajustar antes de guardar.
            </p>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}

