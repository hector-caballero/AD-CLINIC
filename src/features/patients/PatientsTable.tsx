import { ClipboardList, Mail, Pencil, ShieldAlert, Trash2 } from 'lucide-react'
import { formatPatientDocument, formatPhonePY, getInitials } from '../../lib/format'
import { getPatientFullName, type Patient, type PatientStatus } from './patient-types'

const STATUS_STYLES: Record<PatientStatus, { label: string; className: string }> = {
  active: { label: 'Activo', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  inactive: { label: 'Inactivo', className: 'bg-slate-100 text-slate-600 ring-slate-200' },
  archived: { label: 'Archivado', className: 'bg-amber-50 text-amber-800 ring-amber-200' },
}

function PatientStatusBadge({ status }: { status: PatientStatus }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.inactive

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${style.className}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {style.label}
    </span>
  )
}

function PatientAvatar({ patient }: { patient: Patient }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 ring-1 ring-brand-100"
    >
      {getInitials(getPatientFullName(patient))}
    </span>
  )
}

function AllergyChips({ patient }: { patient: Patient }) {
  const allergies = patient.allergies ?? []

  if (allergies.length === 0) {
    return <span className="text-xs text-slate-400">Sin alergias</span>
  }

  const visible = allergies.slice(0, 2)
  const hidden = allergies.length - visible.length

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visible.map((allergy) => (
        <span
          key={allergy}
          className="inline-flex max-w-28 items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-rose-100"
        >
          <ShieldAlert className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{allergy}</span>
        </span>
      ))}
      {hidden > 0 && <span className="text-[11px] font-medium text-slate-400">+{hidden}</span>}
    </div>
  )
}

type PatientsTableProps = {
  patients: Patient[]
  onEdit: (patient: Patient) => void
  onOpenAnamnesis: (patient: Patient) => void
  onDelete: (patient: Patient) => void
}

const HEAD_CLASS = 'px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500'

/** Listado responsivo: tabla en `md+` y tarjetas en móvil. */
export function PatientsTable({
  patients,
  onEdit,
  onOpenAnamnesis,
  onDelete,
}: PatientsTableProps) {
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full divide-y divide-slate-200 text-left">
          <caption className="sr-only">Pacientes registrados en AD Clinic</caption>
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className={HEAD_CLASS}>
                Paciente
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Documento
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Contacto
              </th>
              <th scope="col" className={`hidden lg:table-cell ${HEAD_CLASS}`}>
                Alergias
              </th>
              <th scope="col" className={HEAD_CLASS}>
                Estado
              </th>
              <th scope="col" className={`text-right ${HEAD_CLASS}`}>
                Acciones
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {patients.map((patient) => {
              const fullName = getPatientFullName(patient)

              return (
                <tr key={patient.id} className="transition-colors hover:bg-slate-50/80">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <div className="flex items-center gap-3">
                      <PatientAvatar patient={patient} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{fullName}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-400">
                          {patient.email ?? 'Sin email'}
                        </p>
                      </div>
                    </div>
                  </th>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {formatPatientDocument(patient.document_type, patient.document_number)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                    {formatPhonePY(patient.phone) || '—'}
                    <p className="mt-0.5 max-w-40 truncate text-xs text-slate-400">
                      {patient.address ?? 'Sin dirección'}
                    </p>
                  </td>
                  <td className="hidden px-4 py-3 lg:table-cell">
                    <AllergyChips patient={patient} />
                  </td>
                  <td className="px-4 py-3">
                    <PatientStatusBadge status={patient.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onOpenAnamnesis(patient)}
                        aria-label={`Abrir la historia clínica de ${fullName}`}
                        title="Historia clínica / anamnesis"
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-emerald-50 hover:text-emerald-700"
                      >
                        <ClipboardList className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onEdit(patient)}
                        aria-label={`Editar la ficha de ${fullName}`}
                        title="Editar"
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-700"
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(patient)}
                        aria-label={`Eliminar la ficha de ${fullName}`}
                        title="Eliminar"
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-slate-100 md:hidden">
        {patients.map((patient) => {
          const fullName = getPatientFullName(patient)

          return (
            <li key={patient.id} className="flex items-start gap-3 px-4 py-4">
              <PatientAvatar patient={patient} />

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{fullName}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {formatPatientDocument(patient.document_type, patient.document_number)}
                    </p>
                  </div>
                  <PatientStatusBadge status={patient.status} />
                </div>

                <div className="mt-2 space-y-1 text-xs text-slate-500">
                  <p>{formatPhonePY(patient.phone) || 'Sin teléfono'}</p>
                  {patient.email && (
                    <p className="flex items-center gap-1.5">
                      <Mail className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                      <span className="truncate">{patient.email}</span>
                    </p>
                  )}
                </div>

                <div className="mt-2">
                  <AllergyChips patient={patient} />
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenAnamnesis(patient)}
                    aria-label={`Abrir la historia clínica de ${fullName}`}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100"
                  >
                    <ClipboardList className="size-3.5" aria-hidden="true" />
                    Historia
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(patient)}
                    aria-label={`Editar la ficha de ${fullName}`}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white/85 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(patient)}
                    aria-label={`Eliminar la ficha de ${fullName}`}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    Eliminar
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
