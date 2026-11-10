import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  AudioLines,
  CircleCheck,
  Clock,
  Loader2,
  Mic,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  WifiOff,
} from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import {
  createAnamnesisDictation,
  getAnamnesisAiStatus,
  parseAnamnesisWithGemini,
  type AnamnesisDictation,
} from '../../services/anamnesis-ai'
import { getAnamnesisErrorMessage } from './anamnesis-errors'
import { formatConsentSignedAt, formatHistoryDateTime } from './anamnesis-format'
import { fetchMedicalHistory, saveMedicalHistory } from './anamnesis-service'
import {
  EMPTY_ANAMNESIS_FORM,
  mergeAnamnesisDraft,
  parseWeightKg,
  toAnamnesisForm,
  toMedicalHistoryInput,
  type AnamnesisFormValues,
  type MedicalHistory,
} from './anamnesis-types'
import { getPatientFullName, type Patient } from './patient-types'

/**
 * Historia clínica / anamnesis del paciente.
 *
 * Reproduce la hoja de papel de AD Clinic: cada pregunta clínica es un Sí/No y,
 * al marcar «Sí», se despliega su detalle. Arriba está el dictado asistido (Web
 * Speech API + Gemini) y al pie el consentimiento informado, que se firma al
 * guardar (la fecha la sella el trigger de la base).
 *
 * La página lo monta con una `key` por paciente, así que cada apertura parte de
 * cero y carga la ficha desde Supabase.
 */

function inputClass(hasError = false): string {
  return [
    'w-full rounded-xl border bg-white/85 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400',
    hasError ? 'border-red-300' : 'border-slate-300 focus:border-brand-500',
  ].join(' ')
}

type YesNoToggleProps = {
  id: string
  question: string
  value: boolean
  onChange: (value: boolean) => void
}

/** Control Sí/No de la hoja: dos botones excluyentes, accesibles por teclado. */
function YesNoToggle({ id, question, value, onChange }: YesNoToggleProps) {
  const options = [
    { label: 'No', active: !value, next: false },
    { label: 'Sí', active: value, next: true },
  ]

  return (
    <div
      role="group"
      aria-label={question}
      className="inline-flex shrink-0 overflow-hidden rounded-lg ring-1 ring-slate-300"
    >
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          id={`${id}-${option.next ? 'yes' : 'no'}`}
          aria-pressed={option.active}
          onClick={() => onChange(option.next)}
          className={[
            'px-3 py-1.5 text-sm font-semibold transition-colors',
            option.active
              ? 'bg-brand-500 text-ink-950'
              : 'bg-white/70 text-slate-500 hover:bg-brand-50',
          ].join(' ')}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

type FlagFieldProps = {
  /** Base de los `id`: `question`, `details`, `yes` y `no`. */
  id: string
  question: string
  checked: boolean
  onChange: (checked: boolean) => void
  detailsId: string
  detailsLabel: string
  detailsValue: string
  onDetailsChange: (value: string) => void
  detailsPlaceholder: string
}

/** Pregunta Sí/No con su detalle condicional. */
function FlagField({
  id,
  question,
  checked,
  onChange,
  detailsId,
  detailsLabel,
  detailsValue,
  onDetailsChange,
  detailsPlaceholder,
}: FlagFieldProps) {
  return (
    <div className="rounded-xl bg-white/70 px-3 py-3 ring-1 ring-slate-200/80">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p id={`${id}-question`} className="text-sm font-medium text-slate-700">
          {question}
        </p>
        <YesNoToggle id={id} question={question} value={checked} onChange={onChange} />
      </div>

      {checked && (
        <div className="mt-2.5">
          <label htmlFor={detailsId} className="block text-xs font-medium text-slate-500">
            {detailsLabel}
          </label>
          <textarea
            id={detailsId}
            value={detailsValue}
            onChange={(event) => onDetailsChange(event.target.value)}
            rows={2}
            maxLength={500}
            placeholder={detailsPlaceholder}
            className={`${inputClass()} mt-1 resize-y`}
          />
        </div>
      )}
    </div>
  )
}

type LoadState = 'loading' | 'ready' | 'error'
type DictationState = 'idle' | 'listening' | 'processing'

/** Campos booleanos del formulario. */
type FlagKey =
  | 'under_treatment'
  | 'has_disease'
  | 'has_pain'
  | 'has_dental_issues'
  | 'allergic_anesthetics'
  | 'allergic_penicillin'
  | 'allergic_others'
  | 'is_pregnant'
  | 'is_breastfeeding'
  | 'consent_accepted'

/** Campos de texto del formulario. */
type TextKey =
  | 'treatment_details'
  | 'disease_details'
  | 'allergic_details'
  | 'dental_issues_details'
  | 'pain_details'
  | 'child_weight_kg'

type PatientAnamnesisModalProps = {
  patient: Patient
  onClose: () => void
  onSaved: (record: MedicalHistory) => void
}

export function PatientAnamnesisModal({ patient, onClose, onSaved }: PatientAnamnesisModalProps) {
  const isOnline = useOnlineStatus()

  const [values, setValues] = useState<AnamnesisFormValues>(EMPTY_ANAMNESIS_FORM)
  const [record, setRecord] = useState<MedicalHistory | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState<string | null>(null)

  const [dictationState, setDictationState] = useState<DictationState>('idle')
  const [transcript, setTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiNotice, setAiNotice] = useState<string | null>(null)

  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const [aiStatus] = useState(() => getAnamnesisAiStatus())
  const dictationRef = useRef<AnamnesisDictation | null>(null)

  // Carga inicial y reintentos: mismo patrón que `usePatients` (token de
  // recarga + promesa), sin `setState` sincrónico dentro del efecto.
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let isCurrent = true

    fetchMedicalHistory(patient.id)
      .then((data) => {
        if (!isCurrent) return

        setRecord(data)
        setValues(toAnamnesisForm(data))
        setLoadState('ready')
        setLoadError(null)
      })
      .catch((cause: unknown) => {
        if (!isCurrent) return

        setLoadError(getAnamnesisErrorMessage(cause))
        setLoadState('error')
      })

    return () => {
      isCurrent = false
    }
  }, [patient.id, reloadToken])

  function handleRetryLoad() {
    setLoadState('loading')
    setLoadError(null)
    setReloadToken((token) => token + 1)
  }

  // Al cerrar el modal se apaga el micrófono: no queda escuchando de fondo.
  useEffect(
    () => () => {
      dictationRef.current?.dispose()
      dictationRef.current = null
    },
    [],
  )

  function setFlag(field: FlagKey, value: boolean) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  function setText(field: TextKey, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  function handleStartDictation() {
    if (!aiStatus.ready) {
      setAiError(aiStatus.warning)
      return
    }

    setAiError(null)
    setAiNotice(null)
    setTranscript('')
    setInterimTranscript('')
    setDictationState('listening')

    try {
      if (!dictationRef.current) {
        dictationRef.current = createAnamnesisDictation({
          onTranscript: (finalText, interimText) => {
            setTranscript(finalText)
            setInterimTranscript(interimText)
          },
          onError: (message) => {
            setAiError(message)
            setDictationState('idle')
          },
          onStateChange: (state) => {
            // Solo vuelve a «idle» si el corte llegó mientras se escuchaba: al
            // procesar, el botón tiene que seguir mostrando «Procesando…».
            if (state === 'idle') {
              setDictationState((current) => (current === 'listening' ? 'idle' : current))
            }
          },
        })
      }

      dictationRef.current.start()
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'No se pudo iniciar el dictado.')
      setDictationState('idle')
    }
  }

  async function handleStopAndProcess() {
    dictationRef.current?.stop()

    // `stop()` cierra el último fragmento; el provisorio todavía puede servir.
    const text = [transcript, interimTranscript].filter(Boolean).join(' ').trim()

    if (!text) {
      setAiError('No se escuchó nada. Acercate al micrófono y volvé a intentar.')
      setDictationState('idle')
      return
    }

    setDictationState('processing')
    setAiError(null)
    setAiNotice(null)

    try {
      const draft = await parseAnamnesisWithGemini(text)

      setValues((current) => mergeAnamnesisDraft(current, draft))
      setAiNotice(
        'La IA completó las casillas a partir del dictado. Revisá cada dato y guardá la ficha.',
      )
    } catch (error) {
      setAiError(
        error instanceof Error ? error.message : 'No se pudo procesar el dictado con Gemini.',
      )
    } finally {
      setDictationState('idle')
    }
  }

  function handleDiscardTranscript() {
    dictationRef.current?.stop()
    setTranscript('')
    setInterimTranscript('')
    setAiError(null)
    setAiNotice(null)
    setDictationState('idle')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (isSaving || loadState !== 'ready') return

    if (!isOnline) {
      setFormError('Sin conexión: no se puede guardar la historia clínica. Revisá tu internet.')
      return
    }

    if (values.child_weight_kg.trim() && parseWeightKg(values.child_weight_kg) === null) {
      setFormError('El peso debe estar entre 0,01 kg y 250 kg. Usá coma o punto decimal.')
      return
    }

    setFormError(null)
    setIsSaving(true)

    try {
      const saved = await saveMedicalHistory(patient.id, toMedicalHistoryInput(values))

      setRecord(saved)
      setValues(toAnamnesisForm(saved))
      onSaved(saved)
    } catch (error) {
      setFormError(getAnamnesisErrorMessage(error))
    } finally {
      setIsSaving(false)
    }
  }

  const isLoading = loadState === 'loading'
  const isBusy = isSaving || dictationState === 'processing'
  const hasAllergy =
    values.allergic_anesthetics || values.allergic_penicillin || values.allergic_others

  return (
    <Modal
      title="Historia clínica / Anamnesis"
      description={`${getPatientFullName(patient)} · completá la ficha tal como en la hoja de papel de la clínica.`}
      onClose={onClose}
      isBusy={isBusy}
      size="xl"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            {record
              ? `Última actualización: ${formatHistoryDateTime(record.updated_at)}`
              : 'Se guarda una ficha por paciente: al volver a abrirla vas a ver estos datos.'}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
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
              form="anamnesis-form"
              disabled={isSaving || isLoading || loadState === 'error' || !isOnline}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              {isSaving ? 'Guardando…' : 'Guardar historia clínica'}
            </button>
          </div>
        </div>
      }
    >
      <form id="anamnesis-form" onSubmit={handleSubmit} noValidate className="space-y-6">
        {!isOnline && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-800 ring-1 ring-amber-200">
            <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Sin conexión: podés completar la ficha, pero para guardarla necesitás internet (y el
            dictado con IA tampoco funciona).
          </p>
        )}

        {/* --- Dictado asistido ---------------------------------------------- */}
        <section className="rounded-2xl border border-brand-200/80 bg-gradient-to-br from-brand-50 to-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Sparkles className="size-4 text-brand-700" aria-hidden="true" />
                Dictado asistido
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Dictá la anamnesis en voz alta («toma enalapril, es alérgica a la penicilina, dolor
                en la muela del juicio»). La IA completa las casillas y vos las validás.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(transcript || interimTranscript) && dictationState !== 'processing' && (
                <button
                  type="button"
                  onClick={handleDiscardTranscript}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white/85 px-3 py-2 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50"
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  Descartar dictado
                </button>
              )}

              {dictationState === 'listening' ? (
                <button
                  type="button"
                  onClick={() => void handleStopAndProcess()}
                  className="inline-flex items-center gap-2 rounded-xl bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-ink-800"
                >
                  <AudioLines className="size-4 animate-pulse" aria-hidden="true" />
                  Detener y procesar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartDictation}
                  disabled={dictationState === 'processing' || isSaving || !aiStatus.ready}
                  title={aiStatus.ready ? undefined : (aiStatus.warning ?? undefined)}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {dictationState === 'processing' ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Mic className="size-4" aria-hidden="true" />
                  )}
                  {dictationState === 'processing' ? 'Procesando con Gemini…' : 'Dictar con IA'}
                </button>
              )}
            </div>
          </div>

          {dictationState === 'listening' && (
            <p
              role="status"
              className="mt-3 flex items-center gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 ring-1 ring-rose-200"
            >
              <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-500 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-rose-600" />
              </span>
              Escuchando… hablá con naturalidad y presioná «Detener y procesar» al terminar.
            </p>
          )}

          {(transcript || interimTranscript) && (
            <p className="mt-3 max-h-28 overflow-y-auto rounded-xl bg-white/80 px-3 py-2 text-sm leading-relaxed text-slate-700 ring-1 ring-slate-200">
              {transcript}
              {interimTranscript && <span className="text-slate-400"> {interimTranscript}</span>}
            </p>
          )}

          {aiError && (
            <p
              role="alert"
              className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 ring-1 ring-red-200"
            >
              {aiError}
            </p>
          )}

          {aiNotice && (
            <p
              role="status"
              className="mt-3 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200"
            >
              <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {aiNotice}
            </p>
          )}

          {aiStatus.warning && !aiError && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
              {aiStatus.warning}
            </p>
          )}
        </section>

        {loadError && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700 ring-1 ring-red-200 sm:flex-row sm:items-center sm:justify-between"
          >
            <span>{loadError}</span>
            <button
              type="button"
              onClick={handleRetryLoad}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-white"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Reintentar
            </button>
          </div>
        )}

        {formError && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700 ring-1 ring-red-200"
          >
            {formError}
          </p>
        )}

        {isLoading ? (
          <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500 ring-1 ring-slate-200">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Cargando la historia clínica del paciente…
          </p>
        ) : (
          <div className="space-y-5">
            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Antecedentes clínicos
              </legend>

              <FlagField
                id="anamnesis-treatment"
                question="¿Está bajo tratamiento o medicación?"
                checked={values.under_treatment}
                onChange={(next) => setFlag('under_treatment', next)}
                detailsId="anamnesis-treatment_details"
                detailsLabel="¿Qué medicación o tratamiento?"
                detailsPlaceholder="Ej.: enalapril 10 mg por día, antibiótico hasta el viernes…"
                detailsValue={values.treatment_details}
                onDetailsChange={(value) => setText('treatment_details', value)}
              />

              <FlagField
                id="anamnesis-disease"
                question="¿Presenta alguna enfermedad?"
                checked={values.has_disease}
                onChange={(next) => setFlag('has_disease', next)}
                detailsId="anamnesis-disease_details"
                detailsLabel="¿Cuál/es?"
                detailsPlaceholder="Ej.: diabetes tipo 2, hipertensión, cardiopatía…"
                detailsValue={values.disease_details}
                onDetailsChange={(value) => setText('disease_details', value)}
              />

              <FlagField
                id="anamnesis-pain"
                question="¿Tiene dolor o molestias actuales?"
                checked={values.has_pain}
                onChange={(next) => setFlag('has_pain', next)}
                detailsId="anamnesis-pain_details"
                detailsLabel="¿Dónde y desde cuándo?"
                detailsPlaceholder="Ej.: molar inferior derecho, hace 3 días, aumenta con el frío…"
                detailsValue={values.pain_details}
                onDetailsChange={(value) => setText('pain_details', value)}
              />
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Alergias
              </legend>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-white/70 px-3 py-3 ring-1 ring-slate-200/80">
                  <p className="text-sm font-medium text-slate-700">A anestésicos</p>
                  <div className="mt-2">
                    <YesNoToggle
                      id="anamnesis-allergic_anesthetics"
                      question="¿Alergia a anestésicos?"
                      value={values.allergic_anesthetics}
                      onChange={(next) => setFlag('allergic_anesthetics', next)}
                    />
                  </div>
                </div>

                <div className="rounded-xl bg-white/70 px-3 py-3 ring-1 ring-slate-200/80">
                  <p className="text-sm font-medium text-slate-700">A penicilina</p>
                  <div className="mt-2">
                    <YesNoToggle
                      id="anamnesis-allergic_penicillin"
                      question="¿Alergia a la penicilina?"
                      value={values.allergic_penicillin}
                      onChange={(next) => setFlag('allergic_penicillin', next)}
                    />
                  </div>
                </div>

                <div className="rounded-xl bg-white/70 px-3 py-3 ring-1 ring-slate-200/80">
                  <p className="text-sm font-medium text-slate-700">Otras alergias</p>
                  <div className="mt-2">
                    <YesNoToggle
                      id="anamnesis-allergic_others"
                      question="¿Otras alergias?"
                      value={values.allergic_others}
                      onChange={(next) => setFlag('allergic_others', next)}
                    />
                  </div>
                </div>
              </div>

              {hasAllergy && (
                <div className="rounded-xl bg-white/70 px-3 py-3 ring-1 ring-slate-200/80">
                  <label
                    htmlFor="anamnesis-allergic_details"
                    className="block text-xs font-medium text-slate-500"
                  >
                    Detalle de las alergias
                  </label>
                  <textarea
                    id="anamnesis-allergic_details"
                    value={values.allergic_details}
                    onChange={(event) => setText('allergic_details', event.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="Ej.: penicilina (erupción), látex, ibuprofeno…"
                    className={`${inputClass()} mt-1 resize-y`}
                  />
                </div>
              )}
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Antecedentes odontológicos
              </legend>

              <FlagField
                id="anamnesis-dental"
                question="¿Tuvo problemas en tratamientos odontológicos previos?"
                checked={values.has_dental_issues}
                onChange={(next) => setFlag('has_dental_issues', next)}
                detailsId="anamnesis-dental_issues_details"
                detailsLabel="¿Qué pasó? (hemorragias, reacciones, desmayos…)"
                detailsPlaceholder="Ej.: sangrado prolongado después de una extracción…"
                detailsValue={values.dental_issues_details}
                onDetailsChange={(value) => setText('dental_issues_details', value)}
              />
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Datos según el paciente
              </legend>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2.5 rounded-xl bg-slate-50/70 px-3 py-3 ring-1 ring-slate-200/70">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    En caso de mujer
                  </p>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-700">¿Está embarazada?</span>
                    <YesNoToggle
                      id="anamnesis-pregnant"
                      question="¿Está embarazada?"
                      value={values.is_pregnant}
                      onChange={(next) => setFlag('is_pregnant', next)}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-700">¿Está amamantando?</span>
                    <YesNoToggle
                      id="anamnesis-breastfeeding"
                      question="¿Está amamantando?"
                      value={values.is_breastfeeding}
                      onChange={(next) => setFlag('is_breastfeeding', next)}
                    />
                  </div>
                </div>

                <div className="space-y-2 rounded-xl bg-slate-50/70 px-3 py-3 ring-1 ring-slate-200/70">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    En caso de niño/a
                  </p>

                  <label htmlFor="anamnesis-weight" className="block text-sm text-slate-700">
                    Peso (kg)
                  </label>
                  <div className="relative">
                    <input
                      id="anamnesis-weight"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={values.child_weight_kg}
                      onChange={(event) => setText('child_weight_kg', event.target.value)}
                      maxLength={6}
                      placeholder="Ej.: 24,5"
                      aria-describedby="anamnesis-weight-hint"
                      className={`${inputClass()} pr-10`}
                    />
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-slate-400"
                    >
                      kg
                    </span>
                  </div>
                  <p id="anamnesis-weight-hint" className="text-xs text-slate-400">
                    Solo para pacientes pediátricos: dejalo vacío en adultos.
                  </p>
                </div>
              </div>
            </fieldset>

            {/* --- Consentimiento informado ---------------------------------- */}
            <section className="rounded-2xl border border-brand-200 bg-brand-50/70 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <ShieldCheck className="size-4 text-brand-700" aria-hidden="true" />
                Consentimiento informado
              </p>

              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                Declaro haber sido informado/a sobre mi diagnóstico, el plan de tratamiento, los
                riesgos y beneficios esperados, las alternativas disponibles y las consecuencias de
                no tratarme. Autorizo la realización de los procedimientos odontológicos necesarios
                en AD Clinic y el registro de mis datos clínicos para mi atención.
              </p>

              <label
                htmlFor="anamnesis-consent"
                className="mt-3 flex items-start gap-2.5 rounded-xl bg-white/80 px-3 py-2.5 ring-1 ring-slate-200"
              >
                <input
                  id="anamnesis-consent"
                  type="checkbox"
                  checked={values.consent_accepted}
                  onChange={(event) => setFlag('consent_accepted', event.target.checked)}
                  className="mt-0.5 size-4 shrink-0 rounded border-slate-300 accent-brand-600"
                />
                <span className="text-sm text-slate-700">
                  Acepto el consentimiento informado. Queda registrado con la fecha y hora en que
                  se guarda la ficha.
                </span>
              </label>

              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                <Clock className="size-3.5 shrink-0" aria-hidden="true" />
                {values.consent_accepted
                  ? record?.consent_signed_at
                    ? `Firmado el ${formatConsentSignedAt(record.consent_signed_at)}`
                    : 'Se firmará al guardar la ficha.'
                  : 'Sin firmar.'}
              </p>
            </section>
          </div>
        )}
      </form>
    </Modal>
  )
}
