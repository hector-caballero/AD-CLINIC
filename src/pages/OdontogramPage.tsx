import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertCircle, CircleCheck, RefreshCw, Users, X } from 'lucide-react'
import { Modal } from '../components/ui/Modal'
import { useAuth } from '../features/auth/AuthContext'
import { PatientPicker } from '../features/patients/PatientPicker'
import { patientContactLabel } from '../features/patients/patient-contact'
import { getPatientFullName, type Patient } from '../features/patients/patient-types'
import { usePatients } from '../features/patients/usePatients'
import { OdontogramChart } from '../features/odontogram/OdontogramChart'
import { ChargePlanModal, type PlanChargeSubmission } from '../features/odontogram/ChargePlanModal'
import { ToothTreatmentModal } from '../features/odontogram/ToothTreatmentModal'
import { TreatmentBudgetPanel } from '../features/odontogram/TreatmentBudgetPanel'
import { registerTreatmentCharge } from '../features/cash/cash-service'
import type { BilledItemLink } from '../features/odontogram/odontogram-service'
import { DENTITION_OPTIONS } from '../features/odontogram/odontogram-teeth'
import {
  ITEM_STATUS_META,
  getItemLabel,
  isAbsentTooth,
  type Dentition,
  type OdontogramDraft,
  type OdontogramItem,
  type OdontogramItemStatus,
  type ToothSelection,
  type ToothSurface,
} from '../features/odontogram/odontogram-types'
import { useOdontogram } from '../features/odontogram/useOdontogram'
import { getInitials, formatPYG } from '../lib/format'

const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white/85 px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50'

type Notice = { tone: 'success' | 'error'; message: string }

/**
 * Odontograma interactivo y presupuesto dental.
 *
 * - El paciente se elige con el buscador o llega por la URL
 *   (`/odontograma?paciente=<id>`), para poder enlazarlo desde una ficha.
 * - El conmutador cambia entre dentición permanente (FDI 11-48) y temporal
 *   (FDI 51-85); cada una tiene su propio odontograma.
 * - Recepción y administración leen; odontología y administración escriben
 *   (misma regla que las políticas RLS de la base).
 */
export default function OdontogramPage() {
  const { role } = useAuth()
  const canEdit = role === 'admin' || role === 'dentist'

  const [searchParams, setSearchParams] = useSearchParams()
  const patientId = searchParams.get('paciente')

  const [dentition, setDentition] = useState<Dentition>('permanent')
  const [selection, setSelection] = useState<ToothSelection | null>(null)
  const [isPicking, setIsPicking] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [isChargingPlan, setIsChargingPlan] = useState(false)

  const {
    patients,
    isLoading: isLoadingPatients,
    error: patientsError,
    reload: reloadPatients,
  } = usePatients()

  const patient = useMemo(
    () => patients.find((item) => item.id === patientId) ?? null,
    [patients, patientId],
  )

  const odontogram = useOdontogram(patient?.id ?? null, dentition)

  function selectPatient(next: Patient) {
    setSearchParams({ paciente: next.id })
    setSelection(null)
    setNotice(null)
    setIsPicking(false)
  }

  function clearPatient() {
    setSearchParams({})
    setSelection(null)
    setNotice(null)
  }

  function changeDentition(next: Dentition) {
    if (next === dentition) return

    setDentition(next)
    setSelection(null)
    setNotice(null)
  }

  function handleSelectSurface(toothNumber: number, surface: ToothSurface) {
    if (!canEdit) return

    setSelection({ toothNumber, surface })
  }

  function handleSelectTooth(toothNumber: number) {
    if (!canEdit) return

    setSelection({ toothNumber, surface: null })
  }

  async function handleSaveDraft(draft: OdontogramDraft) {
    const item = await odontogram.saveItem(draft)

    setNotice({
      tone: 'success',
      message:
        draft.status === 'absent'
          ? `Pieza ${draft.toothNumber} marcada como ausente.`
          : `Pieza ${draft.toothNumber}: ${
              item.treatment?.name ?? 'procedimiento'
            } guardado en el presupuesto.`,
    })
  }

  async function handleChangeStatus(item: OdontogramItem, status: OdontogramItemStatus) {
    if (busyItemId) return

    setBusyItemId(item.id)
    setNotice(null)

    try {
      await odontogram.changeStatus(item.id, status)

      setNotice({
        tone: 'success',
        message: `Pieza ${item.tooth_number}: ${ITEM_STATUS_META[status].label.toLowerCase()}.`,
      })
    } catch (cause) {
      setNotice({
        tone: 'error',
        message:
          cause instanceof Error
            ? cause.message
            : 'No se pudo cambiar el estado del procedimiento.',
      })
    } finally {
      setBusyItemId(null)
    }
  }

  async function handleRemove(item: OdontogramItem) {
    if (busyItemId) return

    setBusyItemId(item.id)
    setNotice(null)

    try {
      await odontogram.removeItem(item.id)

      setNotice({ tone: 'success', message: `Se quitó del plan: ${getItemLabel(item)}.` })
    } catch (cause) {
      setNotice({
        tone: 'error',
        message:
          cause instanceof Error ? cause.message : 'No se pudo quitar el procedimiento del plan.',
      })
    } finally {
      setBusyItemId(null)
    }
  }

  /**
   * «Cobrar este plan»: manda las líneas elegidas por el mismo flujo de caja que
   * un cobro de tratamiento y luego las enlaza al cargo creado.
   *
   * El cobro ocurre primero: si el enlace falla, se recarga el odontograma y se
   * avisa para revisar la caja antes de reintentar (así no se cobra dos veces).
   */
  async function handleChargePlan(submission: PlanChargeSubmission) {
    if (!patient) return

    const result = await registerTreatmentCharge({
      patientId: patient.id,
      items: submission.lines.map((line) => ({
        treatmentId: line.treatmentId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        toothNumber: line.toothNumber,
        surface: line.surface,
      })),
      collected: submission.collected,
      method: submission.method,
      receiptNumber: submission.receiptNumber,
      notes: submission.notes,
    })

    const treatmentIds = result.treatmentIds ?? []
    const links: BilledItemLink[] = []

    submission.lines.forEach((line, index) => {
      const patientTreatmentId = treatmentIds[index]

      if (patientTreatmentId) links.push({ itemId: line.itemId, patientTreatmentId })
    })

    try {
      if (links.length !== submission.lines.length) {
        throw new Error('La caja no devolvió todos los tratamientos registrados.')
      }

      await odontogram.markBilled(links)
    } catch {
      await odontogram.reload()
      setIsChargingPlan(false)
      setNotice({
        tone: 'error',
        message: `El cobro de ${formatPYG(result.total)} quedó registrado en caja, pero no se pudieron marcar todas las piezas. Revisá el movimiento en Caja antes de volver a cobrar.`,
      })

      return
    }

    setIsChargingPlan(false)
    setNotice({
      tone: 'success',
      message: submission.collected
        ? `Cobro de ${formatPYG(result.total)} registrado en caja.`
        : `Cargo de ${formatPYG(result.total)} enviado a la cuenta del paciente.`,
    })
  }

  const patientName = patient ? getPatientFullName(patient) : ''
  const selectionIsAbsent = selection ? isAbsentTooth(odontogram.items, selection.toothNumber) : false

  return (
    <div className="space-y-5">
      {notice && (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={[
            'flex items-start justify-between gap-3 rounded-xl px-4 py-3 text-sm ring-1',
            notice.tone === 'success'
              ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
              : 'bg-red-50 text-red-700 ring-red-200',
          ].join(' ')}
        >
          <span className="flex items-start gap-2">
            {notice.tone === 'success' ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            )}
            {notice.message}
          </span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Cerrar aviso"
            className="-mr-1 shrink-0 rounded-lg p-1 transition-colors hover:bg-white/60"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {!patient ? (
        <section className="rounded-2xl border border-slate-200/80 bg-white/85 p-5 shadow-card backdrop-blur-md sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
              <Users className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">
                {patientId ? 'No encontramos esa ficha' : 'Elegí el paciente'}
              </h2>
              <p className="mt-1 max-w-prose text-sm leading-relaxed text-slate-500">
                {patientId
                  ? 'El enlace apunta a un paciente que ya no existe o que no está disponible. Elegí otra ficha para abrir su odontograma.'
                  : 'El odontograma y el presupuesto se guardan por paciente. Buscá la ficha por nombre, C.I./RUC o teléfono.'}
              </p>
            </div>
          </div>

          <div className="mt-5">
            {patientsError ? (
              <div className="space-y-3">
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
                  {patientsError}
                </p>
                <button type="button" onClick={reloadPatients} className={SECONDARY_BUTTON_CLASS}>
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Reintentar
                </button>
              </div>
            ) : isLoadingPatients ? (
              <p className="text-sm text-slate-500">Cargando pacientes…</p>
            ) : (
              <PatientPicker
                patients={patients}
                onSelect={selectPatient}
                autoFocus
                maxResults={8}
                idPrefix="odontogram-patient"
              />
            )}
          </div>

          {patientId && (
            <button type="button" onClick={clearPatient} className={`mt-4 ${SECONDARY_BUTTON_CLASS}`}>
              Limpiar selección
            </button>
          )}
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-card backdrop-blur-md sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-bronze-600 text-xs font-semibold text-white ring-1 ring-bronze-500/30"
                >
                  {getInitials(patientName)}
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-slate-900">{patientName}</h2>
                  <p className="truncate text-xs text-slate-500">
                    {patientContactLabel(patient) || 'Sin documento ni teléfono'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="group"
                  aria-label="Tipo de dentición"
                  className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-0.5"
                >
                  {DENTITION_OPTIONS.map((option) => {
                    const isActive = dentition === option.value

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => changeDentition(option.value)}
                        aria-pressed={isActive}
                        className={[
                          'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                          isActive
                            ? 'bg-white/85 text-brand-800 shadow-sm ring-1 ring-slate-200'
                            : 'text-slate-500 hover:text-slate-800',
                        ].join(' ')}
                      >
                        {option.label}
                        <span className="ml-1 text-[10px] font-normal text-slate-400">
                          {option.hint}
                        </span>
                      </button>
                    )
                  })}
                </div>

                <button
                  type="button"
                  onClick={odontogram.reload}
                  className={SECONDARY_BUTTON_CLASS}
                  title="Volver a cargar el odontograma"
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Actualizar
                </button>

                <button
                  type="button"
                  onClick={() => setIsPicking(true)}
                  className={SECONDARY_BUTTON_CLASS}
                >
                  Cambiar paciente
                </button>
              </div>
            </div>

            {!canEdit && (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 ring-1 ring-amber-200">
                Tu perfil puede consultar el odontograma y el presupuesto. Para registrar
                procedimientos necesitás rol de odontología o administración.
              </p>
            )}
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <section
              aria-label="Odontograma"
              aria-busy={odontogram.isLoading}
              className="rounded-2xl border border-slate-200/80 bg-white/85 p-3 shadow-card backdrop-blur-md sm:p-4"
            >
              <OdontogramChart
                dentition={dentition}
                items={odontogram.items}
                selected={selection}
                readOnly={!canEdit}
                onSelectSurface={handleSelectSurface}
                onSelectTooth={handleSelectTooth}
              />
            </section>

            <TreatmentBudgetPanel
              patientName={patientName}
              dentition={dentition}
              items={odontogram.items}
              isLoading={odontogram.isLoading}
              error={odontogram.error}
              readOnly={!canEdit}
              busyItemId={busyItemId}
              onRetry={odontogram.reload}
              onChangeStatus={handleChangeStatus}
              onRemove={handleRemove}
              onChargePlan={() => setIsChargingPlan(true)}
            />
          </div>

          <p className="text-xs leading-relaxed text-slate-400">
            Los importes están en guaraníes (₲) y se copian del catálogo al presupuestar. El
            odontograma guarda un mapa por dentición; la base valida cada pieza según la FDI y las
            políticas RLS permiten escribir solo a odontología y administración.
          </p>
        </>
      )}

      {isPicking && (
        <Modal
          title="Elegir paciente"
          description="El odontograma y el presupuesto se guardan por paciente."
          onClose={() => setIsPicking(false)}
        >
          <PatientPicker
            patients={patients}
            onSelect={selectPatient}
            autoFocus
            maxResults={8}
            idPrefix="odontogram-switch-patient"
          />
        </Modal>
      )}

      {selection && patient && (
        <ToothTreatmentModal
          key={`${dentition}-${selection.toothNumber}-${selection.surface ?? 'full'}`}
          patientName={patientName}
          toothNumber={selection.toothNumber}
          surface={selection.surface}
          items={odontogram.items}
          initialStatus={selectionIsAbsent ? 'absent' : 'budgeted'}
          onClose={() => setSelection(null)}
          onSubmit={handleSaveDraft}
        />
      )}

      {isChargingPlan && patient && (
        <ChargePlanModal
          patientName={patientName}
          items={odontogram.items}
          onClose={() => setIsChargingPlan(false)}
          onSubmit={handleChargePlan}
        />
      )}
    </div>
  )
}
