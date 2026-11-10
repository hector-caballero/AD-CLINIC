import { useMemo, useState } from 'react'
import { AlertCircle, Loader2, RefreshCw, SearchX, Users, X } from 'lucide-react'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { PatientAnamnesisModal } from '../features/patients/PatientAnamnesisModal'
import { PatientFormModal } from '../features/patients/PatientFormModal'
import { PatientsTable } from '../features/patients/PatientsTable'
import { PatientsToolbar } from '../features/patients/PatientsToolbar'
import type { MedicalHistory } from '../features/patients/anamnesis-types'
import { filterPatients } from '../features/patients/filter-patients'
import {
  getPatientFullName,
  type Patient,
  type PatientStatusFilter,
} from '../features/patients/patient-types'
import { softDeletePatient } from '../features/patients/patients-service'
import { usePatients } from '../features/patients/usePatients'

type FormState = { mode: 'create' } | { mode: 'edit'; patient: Patient } | null

const PRIMARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400'

export default function PatientsPage() {
  const {
    patients,
    isLoading,
    isTruncated,
    error,
    reload,
    addPatient,
    replacePatient,
    removePatient,
  } = usePatients()

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<PatientStatusFilter>('all')
  const [formState, setFormState] = useState<FormState>(null)
  const [deleteTarget, setDeleteTarget] = useState<Patient | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [anamnesisTarget, setAnamnesisTarget] = useState<Patient | null>(null)

  const counts = useMemo(
    () => ({
      all: patients.length,
      active: patients.filter((patient) => patient.status === 'active').length,
      inactive: patients.filter((patient) => patient.status !== 'active').length,
    }),
    [patients],
  )

  const visiblePatients = useMemo(
    () => filterPatients(patients, { query, status }),
    [patients, query, status],
  )

  const hasFilters = query.trim().length > 0 || status !== 'all'

  function clearFilters() {
    setQuery('')
    setStatus('all')
  }

  function openCreate() {
    setNotice(null)
    setFormState({ mode: 'create' })
  }

  function openEdit(patient: Patient) {
    setNotice(null)
    setFormState({ mode: 'edit', patient })
  }

  function closeForm() {
    setFormState(null)
  }

  function openAnamnesis(patient: Patient) {
    setNotice(null)
    setAnamnesisTarget(patient)
  }

  function closeAnamnesis() {
    setAnamnesisTarget(null)
  }

  function handleAnamnesisSaved(record: MedicalHistory) {
    const consent = record.consent_signed_at
      ? 'consentimiento firmado'
      : 'consentimiento sin firmar'

    setNotice(
      anamnesisTarget
        ? `Se guardó la historia clínica de ${getPatientFullName(anamnesisTarget)} (${consent}).`
        : `Se guardó la historia clínica (${consent}).`,
    )
    setAnamnesisTarget(null)
  }

  function handleSaved(patient: Patient, mode: 'create' | 'edit') {
    if (mode === 'create') {
      addPatient(patient)
      setNotice(`Se registró a ${getPatientFullName(patient)}.`)
    } else {
      replacePatient(patient)
      setNotice(`Se actualizó la ficha de ${getPatientFullName(patient)}.`)
    }

    setFormState(null)
  }

  function openDelete(patient: Patient) {
    setDeleteError(null)
    setDeleteTarget(patient)
  }

  function closeDelete() {
    if (isDeleting) return

    setDeleteTarget(null)
    setDeleteError(null)
  }

  async function handleDelete() {
    if (!deleteTarget || isDeleting) return

    setIsDeleting(true)
    setDeleteError(null)

    try {
      await softDeletePatient(deleteTarget.id)
      removePatient(deleteTarget.id)
      setNotice(`Se eliminó la ficha de ${getPatientFullName(deleteTarget)}.`)
      setDeleteTarget(null)
    } catch (cause) {
      setDeleteError(
        cause instanceof Error ? cause.message : 'No se pudo eliminar la ficha. Intentá de nuevo.',
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-5">
      <section
        aria-label="Listado de pacientes"
        aria-busy={isLoading}
        className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/85 shadow-card backdrop-blur-md"
      >
        <div className="border-b border-slate-200 px-4 py-4 sm:px-5">
          <PatientsToolbar
            query={query}
            status={status}
            counts={counts}
            onQueryChange={setQuery}
            onStatusChange={setStatus}
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
            Se muestran los primeros {patients.length} pacientes. Usá el buscador para encontrar
            una ficha puntual.
          </div>
        )}

        {error ? (
          <div role="alert" className="flex flex-col items-center px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
              <AlertCircle className="size-7" aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-sm font-semibold text-slate-900">
              No pudimos cargar los pacientes
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
            <p className="text-sm text-slate-500">Cargando pacientes…</p>
          </div>
        ) : visiblePatients.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <SearchX className="size-7" aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-sm font-semibold text-slate-900">
              {hasFilters ? 'Sin resultados para esta búsqueda' : 'Todavía no hay pacientes'}
            </h2>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
              {hasFilters
                ? 'Probá con otro nombre, C.I./RUC o teléfono; también podés quitar los filtros para ver todas las fichas.'
                : 'Registrá la primera ficha para empezar a agendar tratamientos y llevar el historial clínico.'}
            </p>
            {hasFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-5 inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white/85 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
              >
                Limpiar filtros
              </button>
            ) : (
              <button type="button" onClick={openCreate} className={`mt-5 ${PRIMARY_BUTTON_CLASS}`}>
                <Users className="size-4" aria-hidden="true" />
                Registrar paciente
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500 sm:px-5">
              <span>
                Mostrando{' '}
                <span className="font-semibold text-slate-700">{visiblePatients.length}</span> de{' '}
                {patients.length} fichas
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

            <PatientsTable
              patients={visiblePatients}
              onEdit={openEdit}
              onOpenAnamnesis={openAnamnesis}
              onDelete={openDelete}
            />
          </>
        )}
      </section>

      <p className="text-xs leading-relaxed text-slate-400">
        Las fichas eliminadas se conservan con borrado lógico (deleted_at) para no perder el
        historial clínico, las citas ni los cobros asociados.
      </p>

      {formState && (
        <PatientFormModal
          key={formState.mode === 'edit' ? formState.patient.id : 'new-patient'}
          patient={formState.mode === 'edit' ? formState.patient : null}
          onClose={closeForm}
          onSaved={handleSaved}
        />
      )}

      {anamnesisTarget && (
        <PatientAnamnesisModal
          key={anamnesisTarget.id}
          patient={anamnesisTarget}
          onClose={closeAnamnesis}
          onSaved={handleAnamnesisSaved}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Eliminar paciente"
          description={`¿Confirmás que querés eliminar la ficha de ${getPatientFullName(deleteTarget)}? La ficha dejará de aparecer en el listado, pero su historial se conserva.`}
          confirmLabel="Sí, eliminar"
          busyLabel="Eliminando…"
          isBusy={isDeleting}
          error={deleteError}
          onConfirm={handleDelete}
          onClose={closeDelete}
        />
      )}
    </div>
  )
}

