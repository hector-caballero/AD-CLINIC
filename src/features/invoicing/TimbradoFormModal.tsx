import { useState, type FormEvent } from 'react'
import { AlertCircle, Hash, Loader2, Save } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { formatShortDate } from '../../lib/format'
import { formatGroupInput, formatTimbradoInput, getTodayKey } from './invoicing-format'
import { createTimbrado, updateTimbrado, type TimbradoInput } from './invoicing-service'
import {
  TIMBRADO_MODE_OPTIONS,
  getIssuerName,
  getTimbradoRangeLabel,
  isAutomaticNumbering,
  type InvoicingTimbrado,
  type TaxIssuer,
  type TimbradoMode,
} from './invoicing-types'

type TimbradoFormModalProps = {
  issuers: TaxIssuer[]
  /** Timbrado a editar; `null`/ausente crea uno nuevo. */
  timbrado?: InvoicingTimbrado | null
  /** Emisor preseleccionado al crear (el de la fila desde donde se abrió). */
  defaultIssuerId?: string | null
  onClose: () => void
  onSaved: (timbrado: InvoicingTimbrado) => void
}

const INPUT_CLASS =
  'w-full rounded-xl border border-slate-300 bg-white/85 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500'

const LABEL_CLASS = 'mb-1 block text-sm font-medium text-slate-700'

const HELP_CLASS = 'mt-1 text-xs leading-relaxed text-slate-400'

/**
 * Alta y edición de un timbrado de la SET.
 *
 * La modalidad define cómo se numera:
 * - autoimpresor / electrónica: correlativo automático y ascendente;
 * - preimpreso: el talonario se consume desde el tope del rango hacia abajo;
 * - manual: cada comprobante se carga con el número que figura en el papel.
 *
 * `last_number` es el último correlativo usado (`0` = todavía no se emitió).
 */
export function TimbradoFormModal({
  issuers,
  timbrado = null,
  defaultIssuerId = null,
  onClose,
  onSaved,
}: TimbradoFormModalProps) {
  const [issuerId, setIssuerId] = useState(
    timbrado?.issuer_id ?? defaultIssuerId ?? issuers[0]?.id ?? '',
  )
  const [timbradoNumber, setTimbradoNumber] = useState(timbrado?.timbrado_number ?? '')
  const [establishment, setEstablishment] = useState(timbrado?.establishment ?? '001')
  const [emissionPoint, setEmissionPoint] = useState(timbrado?.emission_point ?? '001')
  const [mode, setMode] = useState<TimbradoMode>(timbrado?.mode ?? 'autoimpresor')
  const [rangeFrom, setRangeFrom] = useState(String(timbrado?.range_from ?? 1))
  const [rangeTo, setRangeTo] = useState(String(timbrado?.range_to ?? 100))
  const [lastNumber, setLastNumber] = useState(String(timbrado?.last_number ?? 0))
  const [validFrom, setValidFrom] = useState(timbrado?.valid_from ?? getTodayKey())
  const [validUntil, setValidUntil] = useState(timbrado?.valid_until ?? '')
  const [isActive, setIsActive] = useState(timbrado?.is_active ?? true)
  const [notes, setNotes] = useState(timbrado?.notes ?? '')

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const modeOption = TIMBRADO_MODE_OPTIONS.find((option) => option.value === mode)
  const automatic = isAutomaticNumbering(mode)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSaving) return

    setIsSaving(true)
    setError(null)

    const input: TimbradoInput = {
      issuer_id: issuerId,
      timbrado_number: timbradoNumber,
      establishment,
      emission_point: emissionPoint,
      mode,
      range_from: Number(rangeFrom),
      range_to: Number(rangeTo),
      last_number: Number(lastNumber),
      valid_from: validFrom,
      valid_until: validUntil || null,
      is_active: isActive,
      notes: notes.trim() || null,
    }

    try {
      const saved = timbrado
        ? await updateTimbrado(timbrado.id, input)
        : await createTimbrado(input)

      onSaved(saved)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo guardar el timbrado. Volvé a intentar.',
      )
      setIsSaving(false)
    }
  }

  return (
    <Modal
      title={timbrado ? 'Editar timbrado' : 'Nuevo timbrado'}
      description="Rango autorizado por la SET para un emisor."
      size="lg"
      isBusy={isSaving}
      onClose={onClose}
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
            form="timbrado-form"
            disabled={isSaving}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            {isSaving ? 'Guardando…' : timbrado ? 'Guardar cambios' : 'Crear timbrado'}
          </button>
        </div>
      }
    >
      <form id="timbrado-form" onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="timbrado-issuer" className={LABEL_CLASS}>
            Emisor
          </label>
          <select
            id="timbrado-issuer"
            value={issuerId}
            onChange={(event) => setIssuerId(event.target.value)}
            disabled={isSaving || Boolean(timbrado)}
            className={INPUT_CLASS}
          >
            <option value="">Elegí un emisor…</option>
            {issuers.map((issuer) => (
              <option key={issuer.id} value={issuer.id}>
                {getIssuerName(issuer)} · RUC {issuer.ruc}
              </option>
            ))}
          </select>
          <p className={HELP_CLASS}>
            {timbrado
              ? 'El emisor de un timbrado no se cambia: si hace falta, creá uno nuevo.'
              : 'Cada timbrado pertenece a un único RUC.'}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <label htmlFor="timbrado-number" className={LABEL_CLASS}>
              Número de timbrado
            </label>
            <div className="relative">
              <Hash
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="timbrado-number"
                type="text"
                inputMode="numeric"
                value={timbradoNumber}
                onChange={(event) => setTimbradoNumber(formatTimbradoInput(event.target.value))}
                disabled={isSaving}
                required
                placeholder="12345678"
                className={`${INPUT_CLASS} pl-9 font-mono`}
              />
            </div>
          </div>

          <div>
            <label htmlFor="timbrado-establishment" className={LABEL_CLASS}>
              Establecimiento
            </label>
            <input
              id="timbrado-establishment"
              type="text"
              inputMode="numeric"
              value={establishment}
              onChange={(event) => setEstablishment(formatGroupInput(event.target.value))}
              disabled={isSaving}
              required
              placeholder="001"
              className={`${INPUT_CLASS} text-center font-mono`}
            />
          </div>

          <div>
            <label htmlFor="timbrado-emission-point" className={LABEL_CLASS}>
              Punto de expedición
            </label>
            <input
              id="timbrado-emission-point"
              type="text"
              inputMode="numeric"
              value={emissionPoint}
              onChange={(event) => setEmissionPoint(formatGroupInput(event.target.value))}
              disabled={isSaving}
              required
              placeholder="001"
              className={`${INPUT_CLASS} text-center font-mono`}
            />
          </div>
        </div>

        <div>
          <label htmlFor="timbrado-mode" className={LABEL_CLASS}>
            Modalidad de numeración
          </label>
          <select
            id="timbrado-mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as TimbradoMode)}
            disabled={isSaving}
            className={INPUT_CLASS}
          >
            {TIMBRADO_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className={HELP_CLASS}>
            {modeOption?.description} {modeOption?.numberHint}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="timbrado-range-from" className={LABEL_CLASS}>
              Correlativo desde
            </label>
            <input
              id="timbrado-range-from"
              type="text"
              inputMode="numeric"
              value={rangeFrom}
              onChange={(event) => setRangeFrom(event.target.value.replace(/\D+/g, ''))}
              disabled={isSaving}
              required
              placeholder="1"
              className={`${INPUT_CLASS} text-right font-mono tabular-nums`}
            />
          </div>

          <div>
            <label htmlFor="timbrado-range-to" className={LABEL_CLASS}>
              Correlativo hasta
            </label>
            <input
              id="timbrado-range-to"
              type="text"
              inputMode="numeric"
              value={rangeTo}
              onChange={(event) => setRangeTo(event.target.value.replace(/\D+/g, ''))}
              disabled={isSaving}
              required
              placeholder="100"
              className={`${INPUT_CLASS} text-right font-mono tabular-nums`}
            />
          </div>

          <div>
            <label htmlFor="timbrado-last-number" className={LABEL_CLASS}>
              Último usado
            </label>
            <input
              id="timbrado-last-number"
              type="text"
              inputMode="numeric"
              value={lastNumber}
              onChange={(event) => setLastNumber(event.target.value.replace(/\D+/g, ''))}
              disabled={isSaving}
              required
              placeholder="0"
              className={`${INPUT_CLASS} text-right font-mono tabular-nums`}
            />
          </div>
        </div>

        <p className={HELP_CLASS}>
          {automatic
            ? 'El correlativo lo asigna la base al emitir sobre el rango autorizado.'
            : 'El «último usado» es el último comprobante que ya salió del talonario: de ahí sigue la numeración.'}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="timbrado-valid-from" className={LABEL_CLASS}>
              Vigente desde
            </label>
            <input
              id="timbrado-valid-from"
              type="date"
              value={validFrom}
              onChange={(event) => setValidFrom(event.target.value)}
              disabled={isSaving}
              required
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="timbrado-valid-until" className={LABEL_CLASS}>
              Vigente hasta <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <input
              id="timbrado-valid-until"
              type="date"
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
              disabled={isSaving}
              min={validFrom}
              className={INPUT_CLASS}
            />
          </div>
        </div>

        <div>
          <label htmlFor="timbrado-notes" className={LABEL_CLASS}>
            Notas <span className="font-normal text-slate-400">(opcional)</span>
          </label>
          <textarea
            id="timbrado-notes"
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={isSaving}
            maxLength={300}
            placeholder="Resolución de la SET, vencimiento, etc."
            className={`${INPUT_CLASS} resize-none`}
          />
        </div>

        <label className="flex items-start gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            disabled={isSaving}
            className="mt-0.5 size-4 accent-brand-600"
          />
          <span className="text-sm text-slate-700">
            Timbrado habilitado
            <span className="mt-0.5 block text-xs text-slate-500">
              Un timbrado inactivo no aparece al facturar, aunque conserve su numeración.
            </span>
          </span>
        </label>

        <dl className="grid gap-3 rounded-xl bg-slate-50 px-3 py-3 text-xs ring-1 ring-slate-200 sm:grid-cols-3">
          <div>
            <dt className="uppercase tracking-wide text-slate-500">Rango</dt>
            <dd className="mt-0.5 font-mono text-slate-900">
              {getTimbradoRangeLabel({
                range_from: Number(rangeFrom) || 0,
                range_to: Number(rangeTo) || 0,
              })}
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-slate-500">Vigencia</dt>
            <dd className="mt-0.5 text-slate-900">
              {formatShortDate(validFrom)} —{' '}
              {validUntil ? formatShortDate(validUntil) : 'sin vencimiento'}
            </dd>
          </div>
          <div>
            <dt className="uppercase tracking-wide text-slate-500">Numeración</dt>
            <dd className="mt-0.5 text-slate-900">
              {automatic ? 'Automática' : 'Manual / preimpresa'}
            </dd>
          </div>
        </dl>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-200"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
