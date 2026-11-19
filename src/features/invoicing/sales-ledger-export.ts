import { formatShortDate } from '../../lib/format'
import { getTodayKey } from './invoicing-format'
import { roundPYG } from './invoicing-tax'
import {
  INVOICE_STATUS_META,
  getInvoiceCustomerDocument,
  type Invoice,
} from './invoicing-types'

/**
 * Libro de Ventas para la declaración de IVA.
 *
 * Arma las columnas que pide el contador paraguayo y las exporta sin
 * dependencias externas:
 * - **CSV**: separador `;` y BOM UTF-8, que es lo que Excel en español abre
 *   directo con los acentos correctos.
 * - **Excel**: SpreadsheetML 2003 (`.xls`) con celdas numéricas, para que las
 *   sumas y los filtros funcionen apenas se abre el archivo.
 *
 * Las columnas «Gravada» son la base imponible (importe − IVA): la base guarda
 * importes con IVA incluido y el IVA ya despejado por franja.
 */

export const SALES_LEDGER_HEADERS = [
  'Fecha',
  'Timbrado',
  'N° Factura',
  'Tipo Doc',
  'RUC/CI',
  'Razón Social',
  'Gravada 10%',
  'IVA 10%',
  'Gravada 5%',
  'IVA 5%',
  'Exenta',
  'Total',
  'Estado',
] as const

export type SalesLedgerCell = string | number

export type SalesLedger = {
  headers: readonly string[]
  rows: SalesLedgerCell[][]
}

export type SalesLedgerOptions = {
  /** RUC genérico del cliente ocasional, para etiquetarlo en la columna fiscal. */
  occasionalRuc?: string | null
}

/** Tipo de documento fiscal que se informa en el libro. */
function documentTypeLabel(invoice: Invoice): string {
  return invoice.mode === 'electronic' ? 'Factura electrónica' : 'Factura'
}

/** Filas del libro (una por factura, incluidas las anuladas). */
export function buildSalesLedger(
  invoices: Invoice[],
  options: SalesLedgerOptions = {},
): SalesLedger {
  return {
    headers: SALES_LEDGER_HEADERS,
    rows: invoices.map((invoice) => {
      const amount10 = roundPYG(invoice.amount_10 ?? 0)
      const amount5 = roundPYG(invoice.amount_5 ?? 0)
      const iva10 = roundPYG(invoice.iva_10 ?? 0)
      const iva5 = roundPYG(invoice.iva_5 ?? 0)

      return [
        formatShortDate(invoice.issued_at.slice(0, 10)),
        invoice.timbrado_number,
        invoice.invoice_number,
        documentTypeLabel(invoice),
        getInvoiceCustomerDocument(invoice, options.occasionalRuc),
        invoice.customer_name,
        amount10 - iva10,
        iva10,
        amount5 - iva5,
        iva5,
        roundPYG(invoice.amount_exempt ?? 0),
        roundPYG(invoice.total ?? 0),
        INVOICE_STATUS_META[invoice.status].label,
      ]
    }),
  }
}

/** Celda CSV: se entrecomilla solo si tiene separador, comillas o saltos de línea. */
function escapeCsvCell(value: SalesLedgerCell): string {
  const text = String(value)

  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV con `;` (Excel es-PY) y BOM para que respete los acentos. */
export function toSalesLedgerCsv(ledger: SalesLedger): string {
  const lines = [ledger.headers, ...ledger.rows].map((row) => row.map(escapeCsvCell).join(';'))

  return `\uFEFF${lines.join('\r\n')}\r\n`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function excelCell(value: SalesLedgerCell): string {
  if (typeof value === 'number') {
    return `<Cell ss:StyleID="amount"><Data ss:Type="Number">${value}</Data></Cell>`
  }

  return `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`
}

/** Hoja de cálculo XML (Excel 2003) con los importes como números. */
export function toSalesLedgerExcel(ledger: SalesLedger): string {
  const headerRow = `<Row>${ledger.headers
    .map(
      (header) =>
        `<Cell ss:StyleID="header"><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`,
    )
    .join('')}</Row>`
  const bodyRows = ledger.rows.map((row) => `<Row>${row.map(excelCell).join('')}</Row>`).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#F1F5F9" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="amount">
      <NumberFormat ss:Format="#,##0"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Libro Ventas">
    <Table>
      ${headerRow}
      ${bodyRows}
    </Table>
  </Worksheet>
</Workbook>`
}

function downloadFile(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** Descarga el libro en CSV (`libro-ventas-YYYY-MM-DD.csv`). */
export function downloadSalesLedgerCsv(
  invoices: Invoice[],
  options: SalesLedgerOptions = {},
): void {
  downloadFile(
    toSalesLedgerCsv(buildSalesLedger(invoices, options)),
    `libro-ventas-${getTodayKey()}.csv`,
    'text/csv;charset=utf-8',
  )
}

/** Descarga el libro en Excel 2003 (`libro-ventas-YYYY-MM-DD.xls`). */
export function downloadSalesLedgerExcel(
  invoices: Invoice[],
  options: SalesLedgerOptions = {},
): void {
  downloadFile(
    toSalesLedgerExcel(buildSalesLedger(invoices, options)),
    `libro-ventas-${getTodayKey()}.xls`,
    'application/vnd.ms-excel;charset=utf-8',
  )
}
