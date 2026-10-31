import { Clock, Loader2, Pencil, Power, PowerOff } from 'lucide-react'
import { formatPYG } from '../../lib/format'
import { formatDuration } from './treatment-format'
import type { Treatment, TreatmentCategoryGroup } from './treatment-types'

const HEAD_CLASS = 'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500'

function TreatmentStatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={[
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1',
        isActive
          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
          : 'bg-slate-100 text-slate-600 ring-slate-200',
      ].join(' ')}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {isActive ? 'Activo' : 'Inactivo'}
    </span>
  )
}

function ToggleActiveButton({
  treatment,
  isBusy,
  onToggleActive,
  withLabel = false,
}: {
  treatment: Treatment
  isBusy: boolean
  onToggleActive: (treatment: Treatment) => void
  withLabel?: boolean
}) {
  const label = treatment.is_active ? 'Desactivar' : 'Activar'

  return (
    <button
      type="button"
      onClick={() => onToggleActive(treatment)}
      disabled={isBusy}
      aria-label={`${label} ${treatment.name}`}
      title={label}
      className={[
        'inline-flex items-center justify-center gap-1.5 rounded-lg transition-colors disabled:cursor-wait disabled:opacity-60',
        withLabel
          ? 'border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50'
          : treatment.is_active
            ? 'p-2 text-slate-400 hover:bg-amber-50 hover:text-amber-700'
            : 'p-2 text-slate-400 hover:bg-emerald-50 hover:text-emerald-700',
      ].join(' ')}
    >
      {isBusy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : treatment.is_active ? (
        <PowerOff className="size-4" aria-hidden="true" />
      ) : (
        <Power className="size-4" aria-hidden="true" />
      )}
      {withLabel && label}
    </button>
  )
}

type TreatmentsTableProps = {
  groups: TreatmentCategoryGroup[]
  pendingId: string | null
  onEdit: (treatment: Treatment) => void
  onToggleActive: (treatment: Treatment) => void
}

/**
 * Catálogo agrupado por especialidad: tabla en `md+` y tarjetas en móvil.
 * Los tratamientos inactivos se atenúan para distinguirlos de los disponibles
 * al momento de cobrar.
 */
export function TreatmentsTable({
  groups,
  pendingId,
  onEdit,
  onToggleActive,
}: TreatmentsTableProps) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left">
          <caption className="sr-only">Catálogo de tratamientos de AD Clinic</caption>
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className={HEAD_CLASS}>
                Código
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Tratamiento
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Duración
              </th>
              <th scope="col" className={`text-right ${HEAD_CLASS}`}>
                Precio
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Estado
              </th>
              <th scope="col" className={`text-right ${HEAD_CLASS}`}>
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>

          {groups.map((group) => (
            <tbody key={group.category}>
              <tr className="border-y border-slate-200 bg-slate-50/80">
                <th
                  scope="colgroup"
                  colSpan={6}
                  className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500"
                >
                  {group.label}
                  <span className="ml-2 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">
                    {group.treatments.length}
                  </span>
                </th>
              </tr>

              {group.treatments.map((treatment) => (
                <tr
                  key={treatment.id}
                  className={[
                    'border-b border-slate-100 transition-colors hover:bg-slate-50/70',
                    treatment.is_active ? '' : 'opacity-60',
                  ].join(' ')}
                >
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-600">
                      {treatment.code}
                    </span>
                  </td>
                  <td className="max-w-md px-4 py-3">
                    <p className="text-sm font-medium text-slate-900">{treatment.name}</p>
                    {treatment.description && (
                      <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">
                        {treatment.description}
                      </p>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="size-3.5 text-slate-400" aria-hidden="true" />
                      {formatDuration(treatment.default_duration_minutes)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold tabular-nums text-slate-900">
                    {formatPYG(treatment.default_price)}
                  </td>
                  <td className="px-4 py-3">
                    <TreatmentStatusBadge isActive={treatment.is_active} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onEdit(treatment)}
                        aria-label={`Editar ${treatment.name}`}
                        title="Editar precio y duración"
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-700"
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </button>
                      <ToggleActiveButton
                        treatment={treatment}
                        isBusy={pendingId === treatment.id}
                        onToggleActive={onToggleActive}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <div className="md:hidden">
        {groups.map((group) => (
          <section key={group.category}>
            <h3 className="flex items-center gap-2 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              {group.label}
              <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">
                {group.treatments.length}
              </span>
            </h3>

            <ul className="divide-y divide-slate-100 border-b border-slate-100">
              {group.treatments.map((treatment) => (
                <li
                  key={treatment.id}
                  className={[
                    'px-4 py-4',
                    treatment.is_active ? '' : 'bg-slate-50/60 opacity-70',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {treatment.name}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500">
                        {treatment.code}
                      </p>
                    </div>
                    <TreatmentStatusBadge isActive={treatment.is_active} />
                  </div>

                  {treatment.description && (
                    <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-500">
                      {treatment.description}
                    </p>
                  )}

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                      <Clock className="size-3.5 text-slate-400" aria-hidden="true" />
                      {formatDuration(treatment.default_duration_minutes)}
                    </span>
                    <p className="text-sm font-semibold tabular-nums text-slate-900">
                      {formatPYG(treatment.default_price)}
                    </p>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onEdit(treatment)}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />
                      Editar
                    </button>
                    <ToggleActiveButton
                      treatment={treatment}
                      isBusy={pendingId === treatment.id}
                      onToggleActive={onToggleActive}
                      withLabel
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}

