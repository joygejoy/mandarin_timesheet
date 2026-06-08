import 'server-only'
// Use the *standalone* browserify bundle of pdfkit instead of the regular
// Node entry point. pdfkit's normal entry reads its built-in PDF Standard 14
// AFM font metrics from disk at runtime via __dirname-relative paths
// (`fs.readFileSync(__dirname + '/data/Helvetica.afm')`). Under Turbopack/
// webpack the package is bundled and __dirname is rewritten, so those reads
// blow up ("ENOENT: Helvetica.afm"). The standalone bundle is built with
// `brfs`, which inlines the AFM data as base64 — no runtime FS lookups.
import PDFDocumentCtor from 'pdfkit/js/pdfkit.standalone'

import type { BiweeklySummary, BiweeklyRow } from '@/lib/payroll'
import type { PayPeriod } from '@/lib/types/db'

export type EnrichedPayrollRow = BiweeklyRow & {
  employee_number: number | null
  department: string | null
}

// pdfkit's `.d.ts` exports the document type as `export = doc`, where
// `doc: PDFKit.PDFDocument` describes both the instance shape AND a `new()`
// signature — usable directly as a constructor.
type PDFDocumentClass = typeof PDFDocumentCtor

/**
 * Render the biweekly payroll summary as a PDF and resolve to a Buffer.
 *
 * Uses pdfkit's built-in Helvetica (PDF Standard 14 font) so no external
 * font files need to ship with the serverless bundle.
 */
export function renderPayrollPdf(
  period: PayPeriod,
  summary: BiweeklySummary,
  rows: EnrichedPayrollRow[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocumentCtor({
        size: 'LETTER',
        margins: { top: 56, bottom: 64, left: 56, right: 56 },
        bufferPages: true, // so we can stamp page numbers in the footer
        info: {
          Title: `Mandarin Timesheet — Payroll ${period.start_date} to ${period.end_date}`,
          Author: 'Mandarin Timesheet',
          Subject: 'Biweekly Payroll Summary',
        },
      })

      const chunks: Buffer[] = []
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      drawHeader(doc, period)
      drawTable(doc, summary, rows)
      stampFooters(doc)

      doc.end()
    } catch (err) {
      reject(err)
    }
  })
}

// ---- Layout helpers --------------------------------------------------------

type Doc = InstanceType<PDFDocumentClass>

function drawHeader(doc: Doc, period: PayPeriod): void {
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor('#111111')
    .text('Mandarin Timesheet — Payroll Summary', { align: 'left' })

  doc.moveDown(0.3)
  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor('#444444')
    .text(`Period: ${formatDate(period.start_date)}  →  ${formatDate(period.end_date)}`)

  doc.text(`Status: ${period.status}`)
  doc.text(`Generated: ${formatTimestamp(new Date())}`)

  doc.moveDown(0.6)

  // Divider
  const x1 = doc.page.margins.left
  const x2 = doc.page.width - doc.page.margins.right
  const y = doc.y
  doc
    .strokeColor('#cccccc')
    .lineWidth(0.5)
    .moveTo(x1, y)
    .lineTo(x2, y)
    .stroke()

  doc.moveDown(0.6)
}

type Column = {
  key: 'emp_num' | 'dept' | 'employee' | 'rate' | 'shifts' | 'hours' | 'gross' | 'meal' | 'net' | 'alcohol'
  label: string
  width: number
  align: 'left' | 'right'
}

function buildColumns(doc: Doc): Column[] {
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right
  // Ratios sum to 1.0
  const ratios = {
    emp_num:  0.07,
    dept:     0.10,
    employee: 0.17,
    rate:     0.08,
    shifts:   0.07,
    hours:    0.09,
    gross:    0.12,
    meal:     0.09,
    net:      0.11,
    alcohol:  0.10,
  }
  return [
    { key: 'emp_num',  label: 'Emp #',       width: usable * ratios.emp_num,  align: 'left'  },
    { key: 'dept',     label: 'Dept',         width: usable * ratios.dept,     align: 'left'  },
    { key: 'employee', label: 'Employee',     width: usable * ratios.employee, align: 'left'  },
    { key: 'rate',     label: 'Rate',         width: usable * ratios.rate,     align: 'right' },
    { key: 'shifts',   label: 'Shifts',       width: usable * ratios.shifts,   align: 'right' },
    { key: 'hours',    label: 'Hours',        width: usable * ratios.hours,    align: 'right' },
    { key: 'gross',    label: 'Gross pay',    width: usable * ratios.gross,    align: 'right' },
    { key: 'meal',     label: 'Meal $',       width: usable * ratios.meal,     align: 'right' },
    { key: 'net',      label: 'Net pay',      width: usable * ratios.net,      align: 'right' },
    { key: 'alcohol',  label: 'Alcohol pts',  width: usable * ratios.alcohol,  align: 'right' },
  ]
}

function drawTable(doc: Doc, summary: BiweeklySummary, rows: EnrichedPayrollRow[]): void {
  const cols = buildColumns(doc)
  const rowPadX = 6
  const rowPadY = 6
  const headerHeight = 22
  const rowHeight = 20

  const drawHeaderRow = () => {
    const y = doc.y
    const xStart = doc.page.margins.left
    const totalWidth = cols.reduce((acc, c) => acc + c.width, 0)
    // Header background
    doc
      .save()
      .rect(xStart, y, totalWidth, headerHeight)
      .fill('#f3f4f6')
      .restore()
    // Header text
    let x = xStart
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#374151')
    for (const col of cols) {
      doc.text(col.label, x + rowPadX, y + rowPadY, {
        width: col.width - rowPadX * 2,
        align: col.align,
        lineBreak: false,
      })
      x += col.width
    }
    // Separator under header
    doc
      .strokeColor('#e5e7eb')
      .lineWidth(0.5)
      .moveTo(xStart, y + headerHeight)
      .lineTo(xStart + totalWidth, y + headerHeight)
      .stroke()
    doc.y = y + headerHeight
    doc.x = xStart
  }

  const ensureSpace = (needed: number) => {
    const bottomLimit = doc.page.height - doc.page.margins.bottom
    if (doc.y + needed > bottomLimit) {
      doc.addPage()
      drawHeaderRow()
    }
  }

  drawHeaderRow()

  doc.font('Helvetica').fontSize(10).fillColor('#111111')

  if (summary.rows.length === 0) {
    ensureSpace(rowHeight)
    const xStart = doc.page.margins.left
    const totalWidth = cols.reduce((acc, c) => acc + c.width, 0)
    doc
      .font('Helvetica-Oblique')
      .fillColor('#6b7280')
      .text('No approved sheets in this period.', xStart + rowPadX, doc.y + rowPadY, {
        width: totalWidth - rowPadX * 2,
        align: 'left',
        lineBreak: false,
      })
    doc.y += rowHeight
    return
  }

  let zebra = false
  for (const r of rows) {
    ensureSpace(rowHeight)
    const y = doc.y
    const xStart = doc.page.margins.left
    const totalWidth = cols.reduce((acc, c) => acc + c.width, 0)

    if (zebra) {
      doc
        .save()
        .rect(xStart, y, totalWidth, rowHeight)
        .fill('#fafafa')
        .restore()
    }
    zebra = !zebra

    const values: Record<Column['key'], string> = {
      emp_num:  r.employee_number != null ? String(r.employee_number) : '—',
      dept:     r.department ?? '—',
      employee: r.employee_name,
      rate:     `$${r.hourly_rate.toFixed(2)}`,
      shifts:   r.shift_count.toString(),
      hours:    r.total_hours.toFixed(2),
      gross:    `$${r.gross_pay.toFixed(2)}`,
      meal:     r.meal_count > 0 ? `−$${r.meal_deduction.toFixed(2)}` : '—',
      net:      `$${r.net_pay.toFixed(2)}`,
      alcohol:  r.alcohol_points.toString(),
    }

    let x = xStart
    doc.font('Helvetica').fontSize(10).fillColor('#111111')
    for (const col of cols) {
      doc.text(values[col.key], x + rowPadX, y + rowPadY, {
        width: col.width - rowPadX * 2,
        align: col.align,
        lineBreak: false,
        ellipsis: true,
      })
      x += col.width
    }
    doc.y = y + rowHeight
    doc.x = xStart
  }

  // Totals row
  ensureSpace(rowHeight + 4)
  const y = doc.y + 4
  const xStart = doc.page.margins.left
  const totalWidth = cols.reduce((acc, c) => acc + c.width, 0)

  // Top border for totals
  doc
    .strokeColor('#9ca3af')
    .lineWidth(0.75)
    .moveTo(xStart, y)
    .lineTo(xStart + totalWidth, y)
    .stroke()

  doc
    .save()
    .rect(xStart, y, totalWidth, rowHeight)
    .fill('#f3f4f6')
    .restore()

  const totalValues: Record<Column['key'], string> = {
    emp_num:  '',
    dept:     '',
    employee: 'TOTAL',
    rate:     '',
    shifts:   '',
    hours:    summary.total_hours.toFixed(2),
    gross:    `$${summary.total_gross_pay.toFixed(2)}`,
    meal:     `−$${summary.total_meal_deduction.toFixed(2)}`,
    net:      `$${summary.total_pay.toFixed(2)}`,
    alcohol:  summary.total_alcohol_points.toString(),
  }

  let x = xStart
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111')
  for (const col of cols) {
    doc.text(totalValues[col.key], x + rowPadX, y + rowPadY, {
      width: col.width - rowPadX * 2,
      align: col.align,
      lineBreak: false,
    })
    x += col.width
  }
  doc.y = y + rowHeight
  doc.x = xStart
}

function stampFooters(doc: Doc): void {
  const range = doc.bufferedPageRange() // { start, count }
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    const pageNum = i - range.start + 1
    const total = range.count
    const y = doc.page.height - doc.page.margins.bottom + 24
    const xLeft = doc.page.margins.left
    const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#9ca3af')
      .text(`Page ${pageNum} of ${total}`, xLeft, y, {
        width: usable,
        align: 'center',
        lineBreak: false,
      })
  }
}

// ---- Formatting ------------------------------------------------------------

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatTimestamp(d: Date): string {
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}
