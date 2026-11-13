import { useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Search,
} from 'lucide-react'
import {
  getRucLookupSiteUrl,
  isRucActivo,
  lookupRucParaguay,
  RucLookupError,
  type RucLookupResult,
} from '../../services/turuc-service'
import { autoFormatRuc, formatRucInput, isValidRuc, RUC_FORMAT_HINT } from './invoicing-format'

/**
 * Campo de RUC con máscara paraguaya y consulta a la DNIT.
 *
 * - La máscara (`formatRucInput` al escribir, `autoFormatRuc` al salir del
 *   campo) acepta el guion manual y lo agrega solo cuando falta.
 * - La lupa consulta `turuc.com.py` y, si encuentra el contribuyente, avisa a
 *   quien lo use (`onResolved`) para completar la razón social.
 * - La consulta nunca bloquea el formulario: si falla (CORS, sin red o RUC
 *   inexistente) queda el mensaje y el nombre se escribe a mano.
 */

type RucLookupFieldProps = {
  id: string
  label: ReactNode
  value: string
  onChange: (value: string) => void
  /** Se llama al encontrar el contribuyente: autocompleta el nombre. */
  onResolved?: (result: RucLookupResult) => void
  disabled?: boolean
  required?: boolean
  placeholder?: string
  helpText?: ReactNode
  /** Texto del botón / aria-label; por defecto «Buscar en DNIT». */
  actionLabel?: string
}

const INPUT_CLASS =
  'w-full rounded-xl border border-slate-300 bg-white/85 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500'

const HELP_CLASS = 'mt-1 text-xs leading-relaxed text-slate-400'

const SEARCH_BUTTON_CLASS =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white/85 px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60'

/** Color del badge según el estado que informa la DNIT. */
function statusTone(status: string): 'ok' | 'danger' | 'warning' {
  if (/^ACTIVO$/.test(status)) return 'ok'
  if (/(CANCELAD|BLOQUEAD|BAJA|SUSPENDID)/.test(status)) return 'danger'

  return 'warning'
}

const BADGE_CLASS: Record<'ok' | 'danger' | 'warning', string> = {
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
}

export function RucLookupField({
  id,
  label,
  value,
  onChange,
  onResolved,
  disabled = false,
  required = false,
  placeholder = '3870633-4',
  helpText,
  actionLabel = 'Buscar en DNIT',
}: RucLookupFieldProps) {
  const [isSearching, setIsSearching] = useState(false)
  const [result, setResult] = useState<RucLookupResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isTouched, setIsTouched] = useState(false)
  /** RUC tal como se escribió antes de consultar (para avisar si la DNIT corrige el DV). */
  const [lookedUpFrom, setLookedUpFrom] = useState('')

  const feedbackId = `${id}-feedback`
  const formatWarning = isTouched && value.trim().length > 0 && !isValidRuc(autoFormatRuc(value))

  function handleChange(nextValue: string) {
    // Cualquier edición invalida el resultado anterior: hay que volver a buscar.
    setResult(null)
    setError(null)
    setLookedUpFrom('')
    onChange(formatRucInput(nextValue))
  }

  function handleBlur() {
    setIsTouched(true)

    const formatted = autoFormatRuc(value)

    if (formatted !== value) onChange(formatted)
  }

  async function runLookup() {
    setIsTouched(true)

    const formatted = autoFormatRuc(value)

    if (formatted !== value) onChange(formatted)

    if (!isValidRuc(formatted)) {
      setResult(null)
      setError(`Revisá el RUC: ${RUC_FORMAT_HINT}.`)
      return
    }

    setIsSearching(true)
    setError(null)
    setResult(null)
    setLookedUpFrom(formatted)

    try {
      const found = await lookupRucParaguay(formatted)

      setResult(found)

      // El número canónico puede traer otro DV: se adopta el de la DNIT.
      if (found.ruc !== formatted) onChange(found.ruc)

      onResolved?.(found)
    } catch (cause) {
      setError(
        cause instanceof RucLookupError
          ? cause.message
          : 'No se pudo consultar el RUC. Escribí el nombre a mano.',
      )
    } finally {
      setIsSearching(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter consulta sin enviar el formulario (en el modal es el submit).
    if (event.key !== 'Enter') return

    event.preventDefault()
    void runLookup()
  }

  const tone = result ? statusTone(result.status) : 'warning'

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
        <span className="text-[11px] font-medium text-slate-400">DNIT · Tu RUC</span>
      </div>

      <div className="flex items-start gap-2">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(event) => handleChange(event.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          disabled={disabled || isSearching}
          required={required}
          maxLength={12}
          placeholder={placeholder}
          aria-describedby={feedbackId}
          className={`${INPUT_CLASS} font-mono`}
        />
        <button
          type="button"
          onClick={() => void runLookup()}
          disabled={disabled || isSearching || value.trim().length === 0}
          title={actionLabel}
          aria-label={actionLabel}
          className={SEARCH_BUTTON_CLASS}
        >
          {isSearching ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="size-4" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">{isSearching ? 'Buscando…' : 'Buscar'}</span>
        </button>
      </div>

      <div id={feedbackId} aria-live="polite">
        {error ? (
          <p className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-2 text-xs leading-relaxed text-red-700 ring-1 ring-red-200">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}

        {!error && formatWarning ? (
          <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-amber-700">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>Formato esperado: {RUC_FORMAT_HINT}.</span>
          </p>
        ) : null}

        {!error && result ? (
          <div className="mt-1.5 rounded-xl bg-slate-50 px-2.5 py-2 ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center gap-1.5">
              {isRucActivo(result) ? (
                <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
              ) : (
                <AlertTriangle className="size-3.5 shrink-0 text-amber-600" aria-hidden="true" />
              )}
              <span className="min-w-0 text-xs font-medium text-slate-800">{result.name}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${BADGE_CLASS[tone]}`}
              >
                {result.status || 'SIN ESTADO'}
              </span>
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
              <span className="font-mono">RUC {result.ruc}</span>
              {lookedUpFrom && lookedUpFrom !== result.ruc ? (
                <span className="text-amber-700">
                  La DNIT registra el DV {result.dv}: se corrigió el número.
                </span>
              ) : null}
              {isRucActivo(result) ? null : (
                <span className="text-amber-700">
                  Verificá el estado antes de emitir: la factura puede ser inválida.
                </span>
              )}
              <a
                href={getRucLookupSiteUrl(result.ruc)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-brand-700 hover:underline"
              >
                Ver en Tu RUC
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            </div>
          </div>
        ) : null}

        {!error && !result && helpText ? <p className={HELP_CLASS}>{helpText}</p> : null}
      </div>
    </div>
  )
}

