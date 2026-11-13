import { useMemo, useState, type FormEvent } from 'react'
import {
  AlertCircle,
  Building2,
  CalendarClock,
  Loader2,
  Pencil,
  Plus,
  Power,
  Save,
  UserRound,
} from 'lucide-react'
import { formatPhonePY, formatShortDate } from '../../lib/format'
import {
  saveClinicTaxSettings,
  setTaxIssuerActive,
  setTimbradoActive,
  type ClinicTaxSettingsInput,
} from './invoicing-service'
import {
  autoFormatRuc,
  getTodayKey,
  isValidRuc,
  padSequence,
  RUC_FORMAT_HINT,
} from './invoicing-format'
import {
  OPERATIONAL_MODE_OPTIONS,
  TIMBRADO_MODE_LABELS,
  getIssuerName,
  getIssuerTimbrados,
  getTimbradoRangeLabel,
  isTimbradoExhausted,
  isTimbradoExpired,
  type ClinicTaxSettings,
  type InvoicingTimbrado,
  type OperationalMode,
  type TaxIssuer,
} from './invoicing-types'
import { TaxIssuerFormModal } from './TaxIssuerFormModal'
import { TimbradoFormModal } from './TimbradoFormModal'
import { RucLookupField } from './RucLookupField'

type InvoicingSettingsProps = {
  settings: ClinicTaxSettings | null
  issuers: TaxIssuer[]
  timbrados: InvoicingTimbrado[]
  isLoading: boolean
  error: string | null
  onReload: () => void
}

const INPUT_CLASS =
  'w-full rounded-xl border border-slate-300 bg-white/85 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500'

const LABEL_CLASS = 'mb-1 block text-sm font-medium text-slate-700'

const HELP_CLASS = 'mt-1 text-xs leading-relaxed text-slate-400'

const BADGE_CLASS =
  'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1'

const PRIMARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-3.5 py-2 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-70'

const SECONDARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white/85 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50'

/**
 * Modo operativo de la clínica.
 *
 * `multi_issuer` deja que cada profesional facture con su RUC; `single_company`
 * fija la empresa única y su emisor predeterminado. Acá también se guardan los
 * datos fiscales de la clínica que se imprimen en los comprobantes.
 */
function ClinicModeForm({
  settings,
  issuers,
  onSaved,
}: {
  settings: ClinicTaxSettings | null
  issuers: TaxIssuer[]
  onSaved: () => void
}) {
  const [mode, setMode] = useState<OperationalMode>(settings?.operational_mode ?? 'multi_issuer')
  const [defaultIssuerId, setDefaultIssuerId] = useState(settings?.default_issuer_id ?? '')
  const [legalName, setLegalName] = useState(settings?.legal_name ?? '')
  const [ruc, setRuc] = useState(settings?.ruc ? autoFormatRuc(settings.ruc) : '')
  const [address, setAddress] = useState(settings?.address ?? '')
  const [phone, setPhone] = useState(settings?.phone ? formatPhonePY(settings.phone) : '')
  const [email, setEmail] = useState(settings?.email ?? '')

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSaving) return

    const formattedRuc = autoFormatRuc(ruc)

    if (formattedRuc && !isValidRuc(formattedRuc)) {
      setNotice(null)
      setError(`Revisá el RUC de la clínica: ${RUC_FORMAT_HINT}.`)
      return
    }

    setIsSaving(true)
    setError(null)
    setNotice(null)

    const input: ClinicTaxSettingsInput = {
      operational_mode: mode,
      default_issuer_id: defaultIssuerId || null,
      legal_name: legalName.trim() || null,
      ruc: formattedRuc || null,
      address: address.trim() || null,
      phone: phone.replace(/\D+/g, '') || null,
      email: email.trim() || null,
    }

    try {
      await saveClinicTaxSettings(input)
      setNotice('Configuración fiscal guardada.')
      onSaved()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No se pudo guardar la configuración fiscal. Volvé a intentar.',
      )
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <fieldset>
        <legend className={LABEL_CLASS}>Modo operativo</legend>
        <div className="grid gap-2 lg:grid-cols-2">
          {OPERATIONAL_MODE_OPTIONS.map((option) => {
            const selected = mode === option.value
            const Icon = option.value === 'single_company' ? Building2 : UserRound

            return (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 transition-colors ${
                  selected
                    ? 'border-brand-400 bg-brand-50/60 ring-1 ring-brand-200'
                    : 'border-slate-200 bg-white/85 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="operational-mode"
                  value={option.value}
                  checked={selected}
                  onChange={() => setMode(option.value)}
                  disabled={isSaving}
                  className="mt-0.5 size-4 accent-brand-600"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    <Icon className="size-4 text-slate-500" aria-hidden="true" />
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                    {option.description}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="clinic-default-issuer" className={LABEL_CLASS}>
            Emisor predeterminado
          </label>
          <select
            id="clinic-default-issuer"
            value={defaultIssuerId}
            onChange={(event) => setDefaultIssuerId(event.target.value)}
            disabled={isSaving}
            className={INPUT_CLASS}
          >
            <option value="">Sin predeterminado</option>
            {issuers.map((issuer) => (
              <option key={issuer.id} value={issuer.id}>
                {getIssuerName(issuer)} · RUC {issuer.ruc}
              </option>
            ))}
          </select>
          <p className={HELP_CLASS}>
            Se usa cuando el profesional que atendió no tiene un emisor vinculado.
          </p>
        </div>

        <div>
          <label htmlFor="clinic-legal-name" className={LABEL_CLASS}>
            Razón social
          </label>
          <input
            id="clinic-legal-name"
            type="text"
            value={legalName}
            onChange={(event) => setLegalName(event.target.value)}
            disabled={isSaving}
            maxLength={160}
            placeholder="AD Clinic S.A."
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <RucLookupField
            id="clinic-ruc"
            label="RUC de la clínica"
            value={ruc}
            onChange={setRuc}
            onResolved={(found) => {
              if (!legalName.trim()) setLegalName(found.name)
            }}
            disabled={isSaving}
            placeholder="80012345-6"
            helpText="El RUC unificado que se imprime en las facturas de la clínica."
          />
        </div>

        <div>
          <label htmlFor="clinic-phone" className={LABEL_CLASS}>
            Teléfono
          </label>
          <input
            id="clinic-phone"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(formatPhonePY(event.target.value))}
            disabled={isSaving}
            placeholder="021 123 456"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label htmlFor="clinic-email" className={LABEL_CLASS}>
            Email
          </label>
          <input
            id="clinic-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={isSaving}
            maxLength={160}
            placeholder="administracion@adclinic.com"
            className={INPUT_CLASS}
          />
        </div>

        <div>
          <label htmlFor="clinic-address" className={LABEL_CLASS}>
            Dirección
          </label>
          <input
            id="clinic-address"
            type="text"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            disabled={isSaving}
            maxLength={200}
            placeholder="Av. Mcal. López 1234, Asunción"
            className={INPUT_CLASS}
          />
        </div>
      </div>

      {notice && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200"
        >
          {notice}
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-200"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={isSaving} className={PRIMARY_BUTTON_CLASS}>
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-4" aria-hidden="true" />
          )}
          {isSaving ? 'Guardando…' : 'Guardar configuración'}
        </button>
      </div>
    </form>
  )
}

/** Fila de un emisor con sus acciones (activar/desactivar y editar). */
function IssuerRow({
  issuer,
  timbradoCount,
  isBusy,
  onEdit,
  onToggle,
}: {
  issuer: TaxIssuer
  timbradoCount: number
  isBusy: boolean
  onEdit: () => void
  onToggle: () => void
}) {
  const isCompany = issuer.kind === 'company'

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-slate-900">{issuer.display_name}</p>
          <span
            className={`${BADGE_CLASS} ${
              isCompany
                ? 'bg-indigo-50 text-indigo-700 ring-indigo-200'
                : 'bg-slate-100 text-slate-600 ring-slate-200'
            }`}
          >
            {isCompany ? 'Empresa' : 'Persona física'}
          </span>
          {!issuer.is_active && (
            <span className={`${BADGE_CLASS} bg-amber-50 text-amber-700 ring-amber-200`}>
              Inactivo
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
          RUC {issuer.ruc}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-slate-400">
          {timbradoCount === 0
            ? 'Sin timbrados cargados'
            : `${timbradoCount} timbrado${timbradoCount === 1 ? '' : 's'}`}
          {issuer.legal_name && issuer.legal_name !== issuer.display_name
            ? ` · ${issuer.legal_name}`
            : ''}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          disabled={isBusy}
          className={SECONDARY_BUTTON_CLASS}
          title={issuer.is_active ? 'Desactivar emisor' : 'Activar emisor'}
        >
          <Power className="size-4" aria-hidden="true" />
          {issuer.is_active ? 'Desactivar' : 'Activar'}
        </button>
        <button type="button" onClick={onEdit} disabled={isBusy} className={SECONDARY_BUTTON_CLASS}>
          <Pencil className="size-4" aria-hidden="true" />
          Editar
        </button>
      </div>
    </li>
  )
}

/** Fila de un timbrado: rango, consumo y vigencia. */
function TimbradoRow({
  timbrado,
  todayKey,
  isBusy,
  onEdit,
  onToggle,
}: {
  timbrado: InvoicingTimbrado
  todayKey: string
  isBusy: boolean
  onEdit: () => void
  onToggle: () => void
}) {
  const expired = isTimbradoExpired(timbrado, todayKey)
  const exhausted = isTimbradoExhausted(timbrado)

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="font-mono text-sm font-semibold text-slate-900">
            {timbrado.timbrado_number}
          </p>
          <span className={`${BADGE_CLASS} bg-slate-100 text-slate-600 ring-slate-200`}>
            {TIMBRADO_MODE_LABELS[timbrado.mode]}
          </span>
          {!timbrado.is_active && (
            <span className={`${BADGE_CLASS} bg-amber-50 text-amber-700 ring-amber-200`}>
              Inactivo
            </span>
          )}
          {expired && (
            <span className={`${BADGE_CLASS} bg-red-50 text-red-700 ring-red-200`}>Vencido</span>
          )}
          {exhausted && (
            <span className={`${BADGE_CLASS} bg-red-50 text-red-700 ring-red-200`}>Agotado</span>
          )}
        </div>

        <p className="mt-0.5 text-[11px] text-slate-500">
          {timbrado.establishment}-{timbrado.emission_point} · correlativos{' '}
          {getTimbradoRangeLabel(timbrado)}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="size-3.5" aria-hidden="true" />
            {formatShortDate(timbrado.valid_from)}
            {timbrado.valid_until ? ` → ${formatShortDate(timbrado.valid_until)}` : ' → sin vencimiento'}
          </span>
          <span className="tabular-nums">
            Último usado: {timbrado.last_number === 0 ? '—' : padSequence(timbrado.last_number)}
          </span>
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onToggle}
          disabled={isBusy}
          className={SECONDARY_BUTTON_CLASS}
          title={timbrado.is_active ? 'Desactivar timbrado' : 'Activar timbrado'}
        >
          <Power className="size-4" aria-hidden="true" />
          {timbrado.is_active ? 'Desactivar' : 'Activar'}
        </button>
        <button type="button" onClick={onEdit} disabled={isBusy} className={SECONDARY_BUTTON_CLASS}>
          <Pencil className="size-4" aria-hidden="true" />
          Editar
        </button>
      </div>
    </li>
  )
}

/**
 * Configuración fiscal del consultorio: modo operativo, emisores y timbrados.
 *
 * Es la pantalla que decide cómo factura la clínica. Todo cambio recarga el
 * snapshot de `useInvoicing` (`onReload`) para que el formulario de emisión use
 * enseguida los emisores y timbrados nuevos.
 */
export function InvoicingSettings({
  settings,
  issuers,
  timbrados,
  isLoading,
  error,
  onReload,
}: InvoicingSettingsProps) {
  const todayKey = useMemo(() => getTodayKey(), [])
  const [issuerModal, setIssuerModal] = useState<{ issuer: TaxIssuer | null } | null>(null)
  const [timbradoModal, setTimbradoModal] = useState<{
    timbrado: InvoicingTimbrado | null
    issuerId: string | null
  } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function handleToggleIssuer(issuer: TaxIssuer) {
    setBusyId(issuer.id)
    setActionError(null)

    try {
      await setTaxIssuerActive(issuer.id, !issuer.is_active)
      onReload()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo actualizar el emisor.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleToggleTimbrado(timbrado: InvoicingTimbrado) {
    setBusyId(timbrado.id)
    setActionError(null)

    try {
      await setTimbradoActive(timbrado.id, !timbrado.is_active)
      onReload()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'No se pudo actualizar el timbrado.')
    } finally {
      setBusyId(null)
    }
  }

  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center rounded-2xl border border-slate-200/80 bg-white/85 px-6 py-14 text-center shadow-card backdrop-blur-md"
      >
        <span className="flex size-14 items-center justify-center rounded-2xl bg-red-50 text-red-600">
          <AlertCircle className="size-7" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-sm font-semibold text-slate-900">
          No pudimos cargar la configuración fiscal
        </h2>
        <p className="mt-1 max-w-md text-sm leading-relaxed text-slate-500">{error}</p>
        <button type="button" onClick={onReload} className={`mt-5 ${PRIMARY_BUTTON_CLASS}`}>
          <Loader2 className="size-4" aria-hidden="true" />
          Reintentar
        </button>
      </div>
    )
  }

  if (isLoading && !settings) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/85 px-6 py-20 text-center shadow-card"
      >
        <Loader2 className="size-6 animate-spin text-brand-600" aria-hidden="true" />
        <p className="text-sm text-slate-500">Cargando la configuración fiscal…</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/85 shadow-card backdrop-blur-md">
        <header className="border-b border-slate-200 px-4 py-4 sm:px-5">
          <h2 className="text-sm font-semibold text-slate-900">Modo y datos fiscales</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            Define si factura cada profesional con su RUC (multi-emisor) o una sola empresa por todo
            el consultorio, y cuál es el emisor predeterminado.
          </p>
        </header>
        <div className="px-4 py-4 sm:px-5">
          <ClinicModeForm
            key={settings?.updated_at ?? 'new-settings'}
            settings={settings}
            issuers={issuers}
            onSaved={onReload}
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/85 shadow-card backdrop-blur-md">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">Emisores</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              RUC habilitados para facturar. Cada emisor puede tener varios timbrados.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIssuerModal({ issuer: null })}
            className={PRIMARY_BUTTON_CLASS}
          >
            <Plus className="size-4" aria-hidden="true" />
            Nuevo emisor
          </button>
        </header>

        {issuers.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <UserRound className="size-6" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-semibold text-slate-900">Todavía no hay emisores</p>
            <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
              Cargá el primer RUC para poder emitir facturas legales.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {issuers.map((issuer) => (
              <IssuerRow
                key={issuer.id}
                issuer={issuer}
                timbradoCount={getIssuerTimbrados(timbrados, issuer.id).length}
                isBusy={busyId === issuer.id}
                onEdit={() => setIssuerModal({ issuer })}
                onToggle={() => handleToggleIssuer(issuer)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/85 shadow-card backdrop-blur-md">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900">Timbrados</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              Rangos autorizados por la SET. Sin un timbrado vigente y con saldo no se puede emitir.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTimbradoModal({ timbrado: null, issuerId: issuers[0]?.id ?? null })}
            disabled={issuers.length === 0}
            className={PRIMARY_BUTTON_CLASS}
          >
            <Plus className="size-4" aria-hidden="true" />
            Nuevo timbrado
          </button>
        </header>

        {timbrados.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <CalendarClock className="size-6" aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-semibold text-slate-900">Todavía no hay timbrados</p>
            <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
              {issuers.length === 0
                ? 'Primero cargá un emisor: el timbrado siempre pertenece a un RUC.'
                : 'Cargá el rango autorizado por la SET para empezar a numerar facturas.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {issuers.map((issuer) => {
              const issuerTimbrados = getIssuerTimbrados(timbrados, issuer.id)

              if (issuerTimbrados.length === 0) return null

              return (
                <div key={issuer.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 px-4 py-2">
                    <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {getIssuerName(issuer)} · RUC {issuer.ruc}
                    </p>
                    <button
                      type="button"
                      onClick={() => setTimbradoModal({ timbrado: null, issuerId: issuer.id })}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-50"
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                      Agregar
                    </button>
                  </div>

                  <ul className="divide-y divide-slate-100">
                    {issuerTimbrados.map((timbrado) => (
                      <TimbradoRow
                        key={timbrado.id}
                        timbrado={timbrado}
                        todayKey={todayKey}
                        isBusy={busyId === timbrado.id}
                        onEdit={() => setTimbradoModal({ timbrado, issuerId: timbrado.issuer_id })}
                        onToggle={() => handleToggleTimbrado(timbrado)}
                      />
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {actionError && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 ring-1 ring-red-200"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {actionError}
        </p>
      )}

      {issuerModal && (
        <TaxIssuerFormModal
          key={issuerModal.issuer?.id ?? 'new-issuer'}
          issuer={issuerModal.issuer}
          onClose={() => setIssuerModal(null)}
          onSaved={() => {
            setIssuerModal(null)
            onReload()
          }}
        />
      )}

      {timbradoModal && (
        <TimbradoFormModal
          key={timbradoModal.timbrado?.id ?? 'new-timbrado'}
          issuers={issuers}
          timbrado={timbradoModal.timbrado}
          defaultIssuerId={timbradoModal.issuerId}
          onClose={() => setTimbradoModal(null)}
          onSaved={() => {
            setTimbradoModal(null)
            onReload()
          }}
        />
      )}
    </div>
  )
}

