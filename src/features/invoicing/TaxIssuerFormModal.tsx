import { useState, type FormEvent } from 'react'
import { AlertCircle, Building2, Loader2, Save, UserRound } from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { formatPhonePY } from '../../lib/format'
import { useStaffDirectory } from '../team/staff-directory'
import { autoFormatRuc, isValidRuc, RUC_FORMAT_HINT } from './invoicing-format'
import { createTaxIssuer, updateTaxIssuer, type TaxIssuerInput } from './invoicing-service'
import { ISSUER_KIND_OPTIONS, type TaxIssuer, type TaxIssuerKind } from './invoicing-types'
import { RucLookupField } from './RucLookupField'

type TaxIssuerFormModalProps = {
  /** Emisor a editar; `null`/ausente crea uno nuevo. */
  issuer?: TaxIssuer | null
  onClose: () => void
  onSaved: (issuer: TaxIssuer) => void
}

const INPUT_CLASS =
  'w-full rounded-xl border border-slate-300 bg-white/85 px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500'

const LABEL_CLASS = 'mb-1 block text-sm font-medium text-slate-700'

const HELP_CLASS = 'mt-1 text-xs leading-relaxed text-slate-400'

/**
 * Alta y edición de un emisor de facturas.
 *
 * Un emisor es un RUC con nombre: la persona física que factura (modo
 * multi-emisor) o la empresa del consultorio. `linked_user_id` lo asocia al
 * profesional del equipo para que, al facturar un tratamiento, se proponga
 * automáticamente el emisor correcto.
 */
export function TaxIssuerFormModal({ issuer = null, onClose, onSaved }: TaxIssuerFormModalProps) {
  const { members, isLoading: isStaffLoading } = useStaffDirectory()

  const [kind, setKind] = useState<TaxIssuerKind>(issuer?.kind ?? 'individual')
  const [displayName, setDisplayName] = useState(issuer?.display_name ?? '')
  const [legalName, setLegalName] = useState(issuer?.legal_name ?? '')
  const [ruc, setRuc] = useState(issuer?.ruc ? autoFormatRuc(issuer.ruc) : '')
  const [address, setAddress] = useState(issuer?.address ?? '')
  const [phone, setPhone] = useState(issuer?.phone ? formatPhonePY(issuer.phone) : '')
  const [email, setEmail] = useState(issuer?.email ?? '')
  const [linkedUserId, setLinkedUserId] = useState(issuer?.linked_user_id ?? '')
  const [isActive, setIsActive] = useState(issuer?.is_active ?? true)
  const [notes, setNotes] = useState(issuer?.notes ?? '')

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isSaving) return

    const formattedRuc = autoFormatRuc(ruc)

    if (!isValidRuc(formattedRuc)) {
      setError(`Revisá el RUC: ${RUC_FORMAT_HINT}.`)
      return
    }

    setIsSaving(true)
    setError(null)

    const input: TaxIssuerInput = {
      kind,
      display_name: displayName,
      legal_name: legalName.trim() || displayName,
      ruc: formattedRuc,
      address: address.trim() || null,
      phone: phone.replace(/\D+/g, '') || null,
      email: email.trim() || null,
      linked_user_id: linkedUserId || null,
      is_active: isActive,
      notes: notes.trim() || null,
    }

    try {
      const saved = issuer
        ? await updateTaxIssuer(issuer.id, input)
        : await createTaxIssuer(input)

      onSaved(saved)
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'No se pudo guardar el emisor. Volvé a intentar.',
      )
      setIsSaving(false)
    }
  }

  return (
    <Modal
      title={issuer ? 'Editar emisor' : 'Nuevo emisor'}
      description="RUC y datos que se imprimen en la factura."
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
            form="tax-issuer-form"
            disabled={isSaving}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            {isSaving ? 'Guardando…' : issuer ? 'Guardar cambios' : 'Crear emisor'}
          </button>
        </div>
      }
    >
      <form id="tax-issuer-form" onSubmit={handleSubmit} className="space-y-5">
        <fieldset>
          <legend className={LABEL_CLASS}>Tipo de contribuyente</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ISSUER_KIND_OPTIONS.map((option) => {
              const Icon = option.value === 'company' ? Building2 : UserRound
              const selected = kind === option.value

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
                    name="issuer-kind"
                    value={option.value}
                    checked={selected}
                    onChange={() => setKind(option.value)}
                    disabled={isSaving}
                    className="mt-0.5 size-4 accent-brand-600"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
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
            <label htmlFor="issuer-display-name" className={LABEL_CLASS}>
              Nombre en la factura
            </label>
            <input
              id="issuer-display-name"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              disabled={isSaving}
              maxLength={120}
              required
              placeholder="Dra. Ana López"
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="issuer-legal-name" className={LABEL_CLASS}>
              Razón social / nombre legal
            </label>
            <input
              id="issuer-legal-name"
              type="text"
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
              disabled={isSaving}
              maxLength={160}
              placeholder="Ana María López Giménez"
              className={INPUT_CLASS}
            />
            <p className={HELP_CLASS}>Si lo dejás vacío se usa el nombre de la factura.</p>
          </div>

          <div>
            <RucLookupField
              id="issuer-ruc"
              label="RUC"
              value={ruc}
              onChange={setRuc}
              onResolved={(found) => {
                if (!displayName.trim()) setDisplayName(found.name)
                if (!legalName.trim()) setLegalName(found.name)
              }}
              disabled={isSaving}
              required
              placeholder="80012345-6"
              helpText="Base + dígito verificador tal como figura en la DNIT. La lupa lo consulta y completa la razón social."
            />
          </div>

          <div>
            <label htmlFor="issuer-phone" className={LABEL_CLASS}>
              Teléfono
            </label>
            <input
              id="issuer-phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(formatPhonePY(event.target.value))}
              disabled={isSaving}
              placeholder="0981 123 456"
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="issuer-email" className={LABEL_CLASS}>
              Email
            </label>
            <input
              id="issuer-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={isSaving}
              maxLength={160}
              placeholder="facturacion@consultorio.com"
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="issuer-address" className={LABEL_CLASS}>
              Dirección
            </label>
            <input
              id="issuer-address"
              type="text"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              disabled={isSaving}
              maxLength={200}
              placeholder="Av. Mcal. López 1234, Asunción"
              className={INPUT_CLASS}
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="issuer-linked-user" className={LABEL_CLASS}>
              Profesional vinculado
            </label>
            <select
              id="issuer-linked-user"
              value={linkedUserId}
              onChange={(event) => setLinkedUserId(event.target.value)}
              disabled={isSaving || isStaffLoading}
              className={INPUT_CLASS}
            >
              <option value="">Sin vincular</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name}
                </option>
              ))}
            </select>
            <p className={HELP_CLASS}>
              Al facturar un tratamiento de este profesional se propone su emisor. Solo aplica en
              modo multi-emisor.
            </p>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="issuer-notes" className={LABEL_CLASS}>
              Notas <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <textarea
              id="issuer-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={isSaving}
              maxLength={300}
              placeholder="Datos internos: régimen, contador, etc."
              className={`${INPUT_CLASS} resize-none`}
            />
          </div>
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
            Emisor habilitado
            <span className="mt-0.5 block text-xs text-slate-500">
              Si lo desactivás no aparece al facturar, pero sus facturas ya emitidas se conservan.
            </span>
          </span>
        </label>

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
