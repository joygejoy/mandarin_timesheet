import 'server-only'
import * as XLSX from 'xlsx'

/**
 * Convert an Excel workbook to a single CSV-like text blob covering every
 * sheet, suitable for the same downstream parser used for plain CSV uploads.
 */
export function xlsxToText(buf: Buffer): string {
  const wb = XLSX.read(buf, { type: 'buffer' })
  const blocks: string[] = []
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false })
    if (csv.trim()) blocks.push(csv)
  }
  return blocks.join('\n').trim()
}
