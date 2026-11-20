import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowLeftRight,
  FileText,
  Loader2,
  Printer,
  Receipt,
  Ruler,
} from 'lucide-react'
import { Modal } from '../../components/ui/Modal'
import { formatPYG } from '../../lib/format'
import { CashReceiptA4, InvoicePrintA4 } from './InvoicePrintA4'
import {
  INVOICE_PRINT_COPY_OPTIONS,
  INVOICE_PRINT_FORMAT_LABELS,
  INVOICE_PRINT_FORMAT_OPTIONS,
  INVOICE_PRINT_FORMAT_SHORT_LABELS,
  formatPrintOffset,
  isManualPrintFormat,
  isOverlayPrintFormat,
  normalizePrintOffset,
  resolveIssuerPrintSettings,
  type IssuerPrintSettings,
} from './invoicing-print'
import {
  getOccasionalCustomer,
  type Invoice,
  type InvoicePrintCopies,
  type InvoicePrintFormat,
} from './invoicing-types'
import { useInvoicing } from './useInvoicing'

type InvoicePrintModalProps = {
  invoice: Invoice
  onClose: () => void
}

/**
 * Borrador de la impresión: los números normalizados más el texto crudo de los
 * márgenes mientras se tipea (`-2,5` todavía no es un número válido).
 */
type PrintDraft = IssuerPrintSettings & {
  offsetXText?: string
  offsetYText?: string
}

const FORMAT_ICONS = {
  electronic_kude: FileText,
  autoimpresor_a4: Printer,
  preprinted_overlay: Ruler,
  manual_none: Receipt,
} as const

const INPUT_CLASS =
  'w-full rounded-xl border border-slate-300 bg-white/85 px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500'

/**
 * Margen de calibración en mm como texto libre: un `input type="number"`
 * controlado descarta el signo menos mientras se tipea, así que no se podrían
 * cargar márgenes negativos (datos que deben subir o correrse a la izquierda).
 * El texto crudo vive en el borrador del modal; acá solo se dibuja.
 */
function OffsetField({
  label,
  hint,
  text,
  disabled,
  onChange,
  onCommit,
}: {
  label: string
  hint: string
  text: string
  disabled?: boolean
  onChange: (text: string) => void
  onCommit: () => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        className={INPUT_CLASS}
      />
      <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>
    </label>
  )
}

/**
 * Vista previa e impresión de una factura emitida.
 *
 * Abre con el formato preferido del emisor (`tax_issuers.print_format`), sus
 * copias y los márgenes de calibración. El usuario puede cambiar el formato solo
 * para esta impresión: reimprimir en otro formato no altera la configuración.
 *
 * La hoja que se manda a la impresora se monta en un portal fuera del modal
 * (`.invoice-print-printonly`), así el navegador pagina A4 sin recortes.
 */
export function InvoicePrintModal({ invoice, onClose }: InvoicePrintModalProps) {
  const { issuers, settings: clinicSettings, isLoading } = useInvoicing()

  const issuer = useMemo(
    () => issuers.find((item) => item.id === invoice.issuer_id) ?? null,
    [issuers, invoice.issuer_id],
  )

  const preferred = useMemo(
    () => resolveIssuerPrintSettings(issuer, invoice.mode),
    [issuer, invoice.mode],
  )

  /** `null` = todavía no se tocó nada: sigue al emisor cuando termina de cargar. */
  const [draft, setDraft] = useState<PrintDraft | null>(null)
  const settings: IssuerPrintSettings = draft ?? preferred

  const [isTestSheet, setIsTestSheet] = useState(false)
  const [pendingPrint, setPendingPrint] = useState(false)

  const occasionalRuc = getOccasionalCustomer(clinicSettings).ruc
  const manual = isManualPrintFormat(settings.format)
  const overlay = isOverlayPrintFormat(settings.format)

  useEffect(() => {
    if (!pendingPrint) return

    // Deja que React pinte la hoja (de prueba o fiscal) antes de abrir el diálogo.
    const timer = window.setTimeout(() => {
      window.print()
      setPendingPrint(false)
    }, 100)

    return () => window.clearTimeout(timer)
  }, [pendingPrint])

  function updateSettings(patch: Partial<PrintDraft>) {
    setDraft({ ...(draft ?? preferred), ...patch })
  }

  function handleFormatChange(format: InvoicePrintFormat) {
    setIsTestSheet(false)
    updateSettings({ format })
  }

  function handlePrintTestSheet() {
    if (!overlay) return
    setIsTestSheet(true)
    setPendingPrint(true)
  }

  const printDocument = manual ? (
    <CashReceiptA4
      invoice={invoice}
      issuer={issuer}
      settings={settings}
      occasionalRuc={occasionalRuc}
    />
  ) : (
    <InvoicePrintA4
      invoice={invoice}
      issuer={issuer}
      settings={settings}
      occasionalRuc={occasionalRuc}
      testSheet={overlay && isTestSheet}
    />
  )

  const printLabel = manual
    ? 'Imprimir Recibo de Dinero A4'
    : overlay && isTestSheet
      ? 'Imprimir hoja de prueba'
      : 'Imprimir factura'

  return (
    <>
      <Modal
        title="Imprimir factura"
        description={`${invoice.invoice_number} · ${formatPYG(invoice.total)}`}
        size="xl"
        onClose={onClose}
        bodyClassName="space-y-4"
        footer={
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-relaxed text-slate-500">
              {isLoading && !issuer
                ? 'Cargando las preferencias de impresión del emisor…'
                : `Formato preferido del emisor: ${INVOICE_PRINT_FORMAT_LABELS[preferred.format]}.`}{' '}
              Podés cambiar la vista solo para esta impresión.
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white/85 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => setPendingPrint(true)}
                disabled={pendingPrint || (overlay && isLoading && !issuer)}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-ink-950 shadow-sm shadow-brand-500/30 ring-1 ring-brand-600/25 transition-colors hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {pendingPrint ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Printer className="size-4" aria-hidden="true" />
                )}
                {pendingPrint ? 'Preparando…' : printLabel}
              </button>
            </div>
          </div>
        }
      >
        <div className="invoice-print-toolbar space-y-4">
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-700">
              Formato de esta impresión
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {INVOICE_PRINT_FORMAT_OPTIONS.map((option) => {
                const Icon = FORMAT_ICONS[option.value]
                const selected = settings.format === option.value

                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => handleFormatChange(option.value)}
                    className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                      selected
                        ? 'border-brand-400 bg-brand-50/70 ring-1 ring-brand-300'
                        : 'border-slate-200 bg-white/80 hover:border-slate-300'
                    }`}
                  >
                    <Icon
                      className={`mt-0.5 size-4 shrink-0 ${
                        selected ? 'text-brand-700' : 'text-slate-400'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-900">
                        {option.shortLabel}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                        {option.description}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="mt-1.5 flex items-start gap-1.5 text-xs leading-relaxed text-slate-400">
              <ArrowLeftRight className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              El formato configurado en el emisor no se modifica con este cambio.
            </p>
          </fieldset>

          {!overlay && (
            <label className="block sm:max-w-xs">
              <span className="mb-1 block text-xs font-medium text-slate-600">Copias</span>
              <select
                value={settings.copies}
                onChange={(event) =>
                  updateSettings({ copies: event.target.value as InvoicePrintCopies })
                }
                className={INPUT_CLASS}
              >
                {INVOICE_PRINT_COPY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] leading-relaxed text-slate-400">
                {INVOICE_PRINT_COPY_OPTIONS.find((option) => option.value === settings.copies)
                  ?.description ?? ''}
              </span>
            </label>
          )}

          {overlay && (
            <div className="space-y-2.5 rounded-xl bg-slate-50 px-3 py-3 ring-1 ring-slate-200">
              <div className="grid gap-3 sm:grid-cols-2">
                <OffsetField
                  label="Margen izquierdo (mm)"
                  hint="Positivo mueve los datos hacia la derecha."
                  text={draft?.offsetXText ?? String(settings.offsetXmm)}
                  disabled={pendingPrint}
                  onChange={(offsetXText) =>
                    updateSettings({
                      offsetXText,
                      offsetXmm: normalizePrintOffset(offsetXText),
                    })
                  }
                  onCommit={() => updateSettings({ offsetXText: undefined })}
                />
                <OffsetField
                  label="Margen superior (mm)"
                  hint="Positivo baja los datos en la hoja."
                  text={draft?.offsetYText ?? String(settings.offsetYmm)}
                  disabled={pendingPrint}
                  onChange={(offsetYText) =>
                    updateSettings({
                      offsetYText,
                      offsetYmm: normalizePrintOffset(offsetYText),
                    })
                  }
                  onCommit={() => updateSettings({ offsetYText: undefined })}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrintTestSheet}
                  disabled={pendingPrint}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white/85 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  <Ruler className="size-4" aria-hidden="true" />
                  Imprimir hoja de prueba
                </button>
                {isTestSheet && (
                  <button
                    type="button"
                    onClick={() => setIsTestSheet(false)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white/85 px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                  >
                    Ver datos de la factura
                  </button>
                )}
                <p className="text-[11px] leading-relaxed text-slate-500">
                  La hoja de prueba dibuja una regla de 10 mm y el desplazamiento actual.
                </p>
              </div>
            </div>
          )}

          {manual && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-amber-900 ring-1 ring-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold">
                  Factura manual registrada en el Libro de Ventas
                </p>
                <p className="mt-0.5 text-xs leading-relaxed">
                  El comprobante legal es el talonario preimpreso. Acá podés imprimir el Recibo de
                  Dinero A4 para el paciente y el archivo del consultorio.
                </p>
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1 text-xs text-slate-500">
              <span>Vista previa A4</span>
              <span className="tabular-nums">
                {INVOICE_PRINT_FORMAT_SHORT_LABELS[settings.format]}
                {overlay
                  ? ` · X ${formatPrintOffset(settings.offsetXmm)} / Y ${formatPrintOffset(
                      settings.offsetYmm,
                    )}`
                  : ''}
              </span>
            </div>
            <div className="invoice-print-viewport max-h-[52vh] overflow-auto rounded-xl bg-slate-100 p-3 ring-1 ring-slate-200">
              <div className="mx-auto w-fit shadow-lg">{printDocument}</div>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              La impresión usa una hoja A4 por página, sin encabezados ni pies del navegador.
            </p>
          </div>
        </div>
      </Modal>

      {createPortal(
        <div className="invoice-print-printonly" aria-hidden="true">
          {printDocument}
        </div>,
        document.body,
      )}
    </>
  )
}


