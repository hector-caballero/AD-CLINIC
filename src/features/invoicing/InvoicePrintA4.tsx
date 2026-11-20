import type { ReactNode } from 'react'
import { formatPYG, formatShortDate } from '../../lib/format'
import { PAYMENT_METHOD_LABELS } from '../cash/cash-types'
import {
  formatPrintOffset,
  getPrintCopyLabels,
  isOverlayPrintFormat,
  type IssuerPrintSettings,
} from './invoicing-print'
import {
  getInvoiceBalance,
  getInvoiceConditionLabel,
  getInvoiceCustomerDocument,
  getInvoiceInstallments,
  getInvoicePaidAmount,
  getIssuerName,
  type Invoice,
  type InvoiceInstallment,
  type TaxIssuer,
} from './invoicing-types'
import './invoice-print.css'

/**
 * Comprobantes imprimibles en A4.
 *
 * `InvoicePrintA4` dibuja la factura según el formato elegido por el emisor:
 * - `electronic_kude`: KuDE con CDC y bloque de QR.
 * - `autoimpresor_a4`: factura fiscal completa sobre hoja en blanco.
 * - `preprinted_overlay`: solo los datos en negro puro, desplazados por los
 *   márgenes en mm configurados, para calzar sobre un formulario preimpreso.
 *
 * `CashReceiptA4` reemplaza a la factura fiscal cuando el emisor usa un talonario
 * manual (`manual_none`): es un recibo interno, no un comprobante legal.
 *
 * La impresión real la dispara `InvoicePrintModal`, que monta el documento en un
 * portal fuera de la app para que el navegador pagine hoja por hoja.
 */

type PrintDocumentProps = {
  invoice: Invoice
  /** Emisor con sus datos fiscales; `null` mientras carga la configuración. */
  issuer: TaxIssuer | null
  settings: IssuerPrintSettings
  /** RUC genérico del cliente ocasional configurado en la clínica. */
  occasionalRuc?: string | null
  /** Hoja de calibración (solo tiene sentido en `preprinted_overlay`). */
  testSheet?: boolean
}

/** `2026-11-11T13:45:00+00:00` → `11/11/2026`. */
function formatIssuedOn(value: string): string {
  return formatShortDate(value.slice(0, 10))
}

function formatDocument(invoice: Invoice, occasionalRuc?: string | null): string {
  return getInvoiceCustomerDocument(invoice, occasionalRuc)
}

function issuerName(invoice: Invoice, issuer: TaxIssuer | null): string {
  return issuer ? getIssuerName(issuer) : getIssuerName(invoice.issuer)
}

export function InvoicePrintA4({
  invoice,
  issuer,
  settings,
  occasionalRuc,
  testSheet = false,
}: PrintDocumentProps) {
  const overlay = isOverlayPrintFormat(settings.format)
  const labels = getPrintCopyLabels(settings.format, settings.copies)

  return (
    <>
      {labels.map((label) => (
        <article
          key={label}
          className={`invoice-print-sheet flex flex-col ${
            overlay ? 'invoice-print-overlay' : 'bg-white text-slate-800'
          }`}
        >
          {overlay ? (
            <OverlaySheet
              invoice={invoice}
              issuer={issuer}
              label={label}
              occasionalRuc={occasionalRuc}
              offsetXmm={settings.offsetXmm}
              offsetYmm={settings.offsetYmm}
              testSheet={testSheet}
            />
          ) : (
            <FiscalSheet
              invoice={invoice}
              issuer={issuer}
              label={label}
              occasionalRuc={occasionalRuc}
              isKude={settings.format === 'electronic_kude'}
            />
          )}
        </article>
      ))}
    </>
  )
}

export function CashReceiptA4({
  invoice,
  issuer,
  settings,
  occasionalRuc,
}: PrintDocumentProps) {
  const labels = getPrintCopyLabels(settings.format, settings.copies)

  return (
    <>
      {labels.map((label) => (
        <article
          key={label}
          className="invoice-print-sheet flex flex-col bg-white px-[12mm] py-[10mm] text-slate-800"
        >
          <ReceiptSheet
            invoice={invoice}
            issuer={issuer}
            label={label}
            occasionalRuc={occasionalRuc}
          />
        </article>
      ))}
    </>
  )
}

/** Bloque de pares etiqueta/valor reutilizado por las maquetas. */
function PrintField({
  label,
  value,
  mono = false,
}: {
  label: string
  value: ReactNode
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[8px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-0.5 truncate text-[10px] font-medium ${mono ? 'font-mono' : ''}`}>
        {value}
      </dd>
    </div>
  )
}

/** Filas del desglose por franja de IVA que realmente tienen importe. */
function vatRows(invoice: Invoice): { label: string; amount: number; iva: number }[] {
  const rows = [
    { label: 'Gravada 10 %', amount: invoice.amount_10, iva: invoice.iva_10 },
    { label: 'Gravada 5 %', amount: invoice.amount_5, iva: invoice.iva_5 },
    { label: 'Exenta', amount: invoice.amount_exempt, iva: 0 },
  ]

  const withAmount = rows.filter((row) => row.amount > 0)

  return withAmount.length > 0
    ? withAmount
    : [{ label: 'Total facturado', amount: invoice.total, iva: 0 }]
}

function InstallmentList({ installments }: { installments: InvoiceInstallment[] }) {
  if (installments.length === 0) return null

  return (
    <table className="mt-2 w-full border-collapse text-[8px]">
      <thead>
        <tr className="border-b border-slate-400 text-left uppercase tracking-wide text-slate-500">
          <th className="py-0.5 font-medium">Cuota</th>
          <th className="py-0.5 font-medium">Vencimiento</th>
          <th className="py-0.5 text-right font-medium">Importe</th>
          <th className="py-0.5 text-right font-medium">Cobrado</th>
        </tr>
      </thead>
      <tbody>
        {installments.map((installment) => (
          <tr key={installment.id} className="border-b border-slate-200">
            <td className="py-0.5">{installment.number}</td>
            <td className="py-0.5">{formatShortDate(installment.due_date)}</td>
            <td className="py-0.5 text-right tabular-nums">{formatPYG(installment.amount)}</td>
            <td className="py-0.5 text-right tabular-nums">
              {formatPYG(installment.paid_amount)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Factura fiscal completa (autoimpresor A4 o KuDE electrónico). */
function FiscalSheet({
  invoice,
  issuer,
  label,
  occasionalRuc,
  isKude,
}: {
  invoice: Invoice
  issuer: TaxIssuer | null
  label: string
  occasionalRuc?: string | null
  isKude: boolean
}) {
  const cancelled = invoice.status === 'cancelled'
  const paid = getInvoicePaidAmount(invoice)
  const balance = getInvoiceBalance(invoice)
  const installments = getInvoiceInstallments(invoice)
  const rows = vatRows(invoice)
  const ivaTotal = invoice.iva_10 + invoice.iva_5
  const grossTotal = invoice.amount_10 + invoice.amount_5 + invoice.amount_exempt

  return (
    <div className="relative flex h-full flex-col px-[12mm] py-[10mm] text-[10px] leading-snug">
      {cancelled && (
        <p className="pointer-events-none absolute inset-0 flex rotate-[-24deg] items-center justify-center text-[58px] font-black uppercase tracking-[0.35em] text-slate-900/10">
          Anulada
        </p>
      )}

      <div className="flex items-center justify-between border-b border-slate-900 pb-1 text-[8px] uppercase tracking-widest">
        <span className="font-semibold">{label}</span>
        <span>{isKude ? 'Documento electrónico · KuDE' : 'Comprobante de venta'}</span>
      </div>

      <header className="mt-[6mm] flex items-start justify-between gap-[8mm]">
        <div className="min-w-0 max-w-[105mm]">
          <p className="text-[16px] font-bold uppercase leading-tight">
            {issuerName(invoice, issuer)}
          </p>
          <p className="mt-1 font-mono text-[10px]">
            RUC {issuer?.ruc ?? invoice.issuer?.ruc ?? '—'}
          </p>
          {issuer?.address && <p className="mt-0.5 text-[9px]">{issuer.address}</p>}
          {(issuer?.phone || issuer?.email) && (
            <p className="mt-0.5 text-[9px] text-slate-600">
              {[issuer?.phone, issuer?.email].filter(Boolean).join(' · ')}
            </p>
          )}
          {issuer && issuer.legal_name !== issuer.display_name && (
            <p className="mt-0.5 text-[9px] text-slate-600">{issuer.legal_name}</p>
          )}
        </div>

        <div className="w-[74mm] shrink-0 border border-slate-900">
          <div className="border-b border-slate-900 px-2 py-1.5 text-center">
            <p className="text-[11px] font-bold uppercase tracking-wide">
              {isKude ? 'Factura Electrónica' : 'Factura'}
            </p>
            <p className="mt-0.5 font-mono text-[11px] font-semibold">{invoice.invoice_number}</p>
          </div>
          <dl className="space-y-0.5 px-2 py-1.5 text-[9px]">
            <div className="flex justify-between gap-2">
              <dt>Timbrado</dt>
              <dd className="font-mono">{invoice.timbrado_number}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Establecimiento</dt>
              <dd className="font-mono">
                {invoice.establishment}-{invoice.emission_point}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Fecha de emisión</dt>
              <dd>{formatIssuedOn(invoice.issued_at)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Condición</dt>
              <dd>{getInvoiceConditionLabel(invoice)}</dd>
            </div>
          </dl>
        </div>
      </header>

      <section className="mt-[5mm] border border-slate-300 px-2.5 py-2">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
          <PrintField label="Cliente" value={invoice.customer_name} />
          <PrintField label="RUC / C.I." value={formatDocument(invoice, occasionalRuc)} mono />
          {invoice.customer_address && (
            <PrintField label="Dirección" value={invoice.customer_address} />
          )}
          {invoice.customer_email && (
            <PrintField label="Email" value={invoice.customer_email} />
          )}
        </div>
      </section>

      <table className="mt-[4mm] w-full border-collapse text-[9px]">
        <thead>
          <tr className="border-y border-slate-900 bg-slate-100 text-left uppercase tracking-wide">
            <th className="py-1 pl-2 font-semibold">Concepto</th>
            <th className="w-[28mm] py-1 pr-2 text-right font-semibold">Importe</th>
            <th className="w-[24mm] py-1 pr-2 text-right font-semibold">IVA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-slate-200">
              <td className="py-1 pl-2">
                Prestación de servicios odontológicos · {row.label}
              </td>
              <td className="py-1 pr-2 text-right tabular-nums">{formatPYG(row.amount)}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{formatPYG(row.iva)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <dl className="grid flex-1 gap-1 text-[9px]">
          <PrintField
            label="Forma de pago"
            value={invoice.payment_method ? PAYMENT_METHOD_LABELS[invoice.payment_method] : '—'}
          />
          <PrintField label="Cobrado" value={formatPYG(paid)} />
        </dl>
        <dl className="w-[72mm] space-y-0.5 text-[9px]">
          <div className="flex justify-between border-b border-slate-200 pb-0.5">
            <dt>Importe (IVA incluido)</dt>
            <dd className="tabular-nums">{formatPYG(grossTotal)}</dd>
          </div>
          <div className="flex justify-between border-b border-slate-200 pb-0.5">
            <dt>IVA despejado</dt>
            <dd className="tabular-nums">{formatPYG(ivaTotal)}</dd>
          </div>
          <div className="flex justify-between border-y-2 border-slate-900 py-1 text-[12px] font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatPYG(invoice.total)}</dd>
          </div>
          {balance > 0 && (
            <div className="flex justify-between text-[10px] font-semibold">
              <dt>Saldo pendiente</dt>
              <dd className="tabular-nums">{formatPYG(balance)}</dd>
            </div>
          )}
        </dl>
      </div>

      {installments.length > 1 && <InstallmentList installments={installments} />}

      {invoice.notes && (
        <p className="mt-2 border-t border-slate-200 pt-1 text-[8px] leading-relaxed text-slate-600">
          {invoice.notes}
        </p>
      )}

      {cancelled && (
        <p className="mt-2 border border-slate-900 px-2 py-1 text-[9px] font-semibold uppercase">
          Factura anulada
          {invoice.cancellation_reason ? `: ${invoice.cancellation_reason}` : ''}
        </p>
      )}

      <footer className="mt-auto flex items-end justify-between gap-6 pt-[6mm]">
        {isKude ? (
          <div className="flex items-end gap-2">
            <div className="flex size-[24mm] shrink-0 flex-col items-center justify-center border border-slate-900 text-center text-[6px] leading-tight">
              <span className="text-[12px] font-bold">QR</span>
              <span>SIFEN · KuDE</span>
            </div>
            <div className="min-w-0">
              <p className="text-[7px] uppercase tracking-wide text-slate-500">CDC</p>
              <p className="break-all font-mono text-[8px]">{invoice.cdc ?? '—'}</p>
              <p className="mt-1 max-w-[90mm] text-[7px] leading-tight text-slate-500">
                Representación gráfica de la factura electrónica. El QR y el CDC definitivos los
                emite el proveedor SIFEN.
              </p>
            </div>
          </div>
        ) : (
          <p className="max-w-[95mm] text-[7px] leading-tight text-slate-500">
            Comprobante emitido con timbrado autorizado por la SET. Conservá este documento para
            cualquier reclamo.
          </p>
        )}

        <div className="w-[62mm] shrink-0 text-center text-[8px]">
          <div className="border-t border-slate-900 pt-1">Firma y sello del emisor</div>
        </div>
      </footer>
    </div>
  )
}

/** Dato suelto de la caída: etiqueta chica + valor en negro puro. */
function OverlayField({
  label,
  value,
  wide = false,
}: {
  label: string
  value: ReactNode
  wide?: boolean
}) {
  return (
    <div className={wide ? 'col-span-full' : undefined}>
      <p className="text-[7px] uppercase tracking-wide">{label}</p>
      <p className="mt-[0.5mm] text-[10px] font-semibold">{value}</p>
    </div>
  )
}

/**
 * Calibración para hojas preimpresas: regla de 10 mm, origen del bloque y
 * desplazamiento actual. Solo se dibuja en la hoja de prueba.
 */
function CalibrationGuides({
  offsetXmm,
  offsetYmm,
}: {
  offsetXmm: number
  offsetYmm: number
}) {
  return (
    <div className="pointer-events-none absolute inset-0 text-[7px] leading-tight">
      <div className="absolute left-[10mm] top-[10mm] size-[10mm] border border-black" />
      <span className="absolute left-[21mm] top-[11mm]">
        10 × 10 mm (control de escala)
      </span>
      <div className="absolute bottom-[12mm] left-[10mm] right-[10mm] top-[10mm] border border-dashed border-black/50" />
      <p className="absolute bottom-[6mm] left-[10mm] right-[10mm] leading-tight">
        HOJA DE PRUEBA · las guías no se imprimen en el modo preimpreso normal. Colocá el formulario
        en la bandeja y ajustá los márgenes hasta que cada dato caiga en su casilla.
      </p>
      <p className="absolute right-[10mm] top-[6mm] font-semibold">
        X {formatPrintOffset(offsetXmm)} · Y {formatPrintOffset(offsetYmm)}
      </p>
    </div>
  )
}

/**
 * Caída sobre formulario preimpreso: sin bordes, fondos ni membrete, con tinta
 * negra y el desplazamiento configurado por el emisor.
 */
function OverlaySheet({
  invoice,
  issuer,
  label,
  occasionalRuc,
  offsetXmm,
  offsetYmm,
  testSheet,
}: {
  invoice: Invoice
  issuer: TaxIssuer | null
  label: string
  occasionalRuc?: string | null
  offsetXmm: number
  offsetYmm: number
  testSheet: boolean
}) {
  return (
    <div className="relative h-full px-[10mm] py-[10mm]">
      {testSheet && <CalibrationGuides offsetXmm={offsetXmm} offsetYmm={offsetYmm} />}

      <div
        className={`space-y-[3mm] text-[9px] ${
          testSheet ? 'border border-dashed border-black/60 p-[2mm]' : ''
        }`}
        style={{ marginLeft: `${offsetXmm}mm`, marginTop: `${offsetYmm}mm` }}
      >
        <div className="flex items-baseline justify-between text-[8px] uppercase tracking-widest">
          <span className="font-semibold">{label}</span>
          <span>{testSheet ? 'Bloque de datos (prueba)' : issuerName(invoice, issuer)}</span>
        </div>

        <div className="grid grid-cols-3 gap-x-[6mm] gap-y-[2mm]">
          <OverlayField label="Fecha" value={formatIssuedOn(invoice.issued_at)} />
          <OverlayField label="Timbrado" value={invoice.timbrado_number} />
          <OverlayField label="Factura Nº" value={invoice.invoice_number} />
        </div>

        <OverlayField label="Cliente" value={invoice.customer_name} wide />
        <OverlayField
          label="RUC / C.I."
          value={formatDocument(invoice, occasionalRuc)}
          wide
        />

        <div className="grid grid-cols-3 gap-x-[6mm] gap-y-[2mm]">
          <OverlayField
            label="Gravada 10 %"
            value={invoice.amount_10 > 0 ? formatPYG(invoice.amount_10) : '—'}
          />
          <OverlayField
            label="IVA 10 %"
            value={invoice.amount_10 > 0 ? formatPYG(invoice.iva_10) : '—'}
          />
          <OverlayField label="Exenta" value={formatPYG(invoice.amount_exempt)} />
          <OverlayField
            label="Gravada 5 %"
            value={invoice.amount_5 > 0 ? formatPYG(invoice.amount_5) : '—'}
          />
          <OverlayField
            label="IVA 5 %"
            value={invoice.amount_5 > 0 ? formatPYG(invoice.iva_5) : '—'}
          />
          <OverlayField label="Condición" value={getInvoiceConditionLabel(invoice)} />
        </div>

        <div className="grid grid-cols-3 gap-x-[6mm] gap-y-[2mm] border-t border-black pt-[2mm]">
          <OverlayField label="Total" value={formatPYG(invoice.total)} />
          <OverlayField label="Cobrado" value={formatPYG(getInvoicePaidAmount(invoice))} />
          <OverlayField label="Saldo" value={formatPYG(getInvoiceBalance(invoice))} />
        </div>

        {invoice.status === 'cancelled' && (
          <OverlayField label="Estado" value="ANULADA" wide />
        )}
      </div>
    </div>
  )
}

/**
 * Recibo de Dinero A4 para emisores con talonario manual: deja constancia del
 * cobro aunque la factura fiscal se haya llenado a mano en el formulario.
 */
function ReceiptSheet({
  invoice,
  issuer,
  label,
  occasionalRuc,
}: {
  invoice: Invoice
  issuer: TaxIssuer | null
  label: string
  occasionalRuc?: string | null
}) {
  const paid = getInvoicePaidAmount(invoice)
  const balance = getInvoiceBalance(invoice)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-900 pb-1 text-[8px] uppercase tracking-widest">
        <span className="font-semibold">{label}</span>
        <span>Documento interno de cobro</span>
      </div>

      <header className="mt-[6mm] flex items-start justify-between gap-[8mm]">
        <div className="min-w-0 max-w-[105mm]">
          <p className="text-[16px] font-bold uppercase leading-tight">
            {issuerName(invoice, issuer)}
          </p>
          <p className="mt-1 font-mono text-[10px]">
            RUC {issuer?.ruc ?? invoice.issuer?.ruc ?? '—'}
          </p>
          {issuer?.address && <p className="mt-0.5 text-[9px]">{issuer.address}</p>}
          {(issuer?.phone || issuer?.email) && (
            <p className="mt-0.5 text-[9px] text-slate-600">
              {[issuer?.phone, issuer?.email].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        <div className="w-[74mm] shrink-0 border border-slate-900">
          <div className="border-b border-slate-900 px-2 py-1.5 text-center">
            <p className="text-[11px] font-bold uppercase tracking-wide">Recibo de Dinero</p>
            <p className="mt-0.5 font-mono text-[11px] font-semibold">
              Nº {invoice.invoice_number}
            </p>
          </div>
          <dl className="space-y-0.5 px-2 py-1.5 text-[9px]">
            <div className="flex justify-between gap-2">
              <dt>Fecha</dt>
              <dd>{formatIssuedOn(invoice.issued_at)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Timbrado</dt>
              <dd className="font-mono">{invoice.timbrado_number}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Establecimiento</dt>
              <dd className="font-mono">
                {invoice.establishment}-{invoice.emission_point}
              </dd>
            </div>
          </dl>
        </div>
      </header>

      <section className="mt-[6mm] border border-slate-300 px-2.5 py-2 text-[10px]">
        <p>
          Recibí de <span className="font-semibold">{invoice.customer_name}</span>, documento{' '}
          <span className="font-mono">{formatDocument(invoice, occasionalRuc)}</span>, la suma de{' '}
          <span className="font-semibold">{formatPYG(paid)}</span> en concepto de servicios
          odontológicos.
        </p>
      </section>

      <table className="mt-[6mm] w-full border-collapse text-[9px]">
        <thead>
          <tr className="border-y border-slate-900 bg-slate-100 text-left uppercase tracking-wide">
            <th className="py-1 pl-2 font-semibold">Detalle</th>
            <th className="w-[32mm] py-1 pr-2 text-right font-semibold">Importe</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-200">
            <td className="py-1.5 pl-2">
              Servicios odontológicos · factura {invoice.invoice_number} (timbrado{' '}
              {invoice.timbrado_number})
            </td>
            <td className="py-1.5 pr-2 text-right tabular-nums">{formatPYG(invoice.total)}</td>
          </tr>
          <tr className="border-b border-slate-200">
            <td className="py-1.5 pl-2">Cobrado a la fecha</td>
            <td className="py-1.5 pr-2 text-right tabular-nums">{formatPYG(paid)}</td>
          </tr>
          <tr className="border-b-2 border-slate-900 text-[11px] font-semibold">
            <td className="py-1.5 pl-2">Saldo pendiente</td>
            <td className="py-1.5 pr-2 text-right tabular-nums">{formatPYG(balance)}</td>
          </tr>
        </tbody>
      </table>

      <p className="mt-[4mm] text-[8px] leading-relaxed text-slate-600">
        Factura manual registrada en el Libro de Ventas. Este recibo no reemplaza al comprobante
        legal: la factura fiscal es el formulario preimpreso emitido con el timbrado{' '}
        {invoice.timbrado_number}. Conservalo para cualquier reclamo.
      </p>

      {invoice.notes && (
        <p className="mt-2 border-t border-slate-200 pt-1 text-[8px] text-slate-600">
          {invoice.notes}
        </p>
      )}

      <div className="mt-auto flex items-end justify-between gap-6 pt-[10mm]">
        <p className="text-[7px] uppercase tracking-wide text-slate-500">
          Cobrado por: {issuerName(invoice, issuer)}
        </p>
        <div className="w-[62mm] shrink-0 text-center text-[8px]">
          <div className="border-t border-slate-900 pt-1">Firma y sello</div>
        </div>
      </div>
    </div>
  )
}





