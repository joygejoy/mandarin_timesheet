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

export type RoledEmployee = {
  name: string
  role: string | null
  employee_number: number | null
  confidence: number
  source_note: string | null
}

/**
 * Parse an employee roster Excel file that has multiple table sections
 * separated by blank rows or TOTAL rows. The first section is assumed to be
 * Servers; the second Busboys. Each subsequent section increments through
 * the known roles list.
 *
 * Expected header row pattern (any section): contains "Emp. No." and
 * "Staff's Name" (or common variants). Data rows follow immediately after.
 */
export function xlsxToRoledEmployees(buf: Buffer): RoledEmployee[] {
  const ROLE_BY_SECTION = ['Server', 'Busboy']
  const NAME_HEADER_RE = /^(staff.?s?\s*name|name|full\s*name|employee\s*name)$/i
  const EMP_NO_HEADER_RE = /^(emp\.?\s*no\.?|employee\s*no\.?|emp\s*#|id|no\.)$/i

  const wb = XLSX.read(buf, { type: 'buffer' })
  const out: RoledEmployee[] = []

  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue

    // sheet_to_json with header:1 gives rows as plain arrays
    const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(sheet, {
      header: 1,
      defval: null,
    })

    let sectionIdx = -1
    let nameCol = -1
    let empNoCol = -1
    const seen = new Set<string>()

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i]
      const cells = (raw as (string | number | null | undefined)[]).map((c) =>
        c == null ? '' : String(c).trim()
      )

      // Blank row — treat as section separator but don't reset counters
      if (cells.every((c) => !c)) continue

      // Detect header rows by looking for the name column header
      const hasNameHeader = cells.some((c) => NAME_HEADER_RE.test(c))
      if (hasNameHeader) {
        sectionIdx++
        nameCol = cells.findIndex((c) => NAME_HEADER_RE.test(c))
        empNoCol = cells.findIndex((c) => EMP_NO_HEADER_RE.test(c))
        // Some rosters (e.g. a single-department name+number list) have no
        // header text at all above the number column — just blank. Fall back
        // to the column immediately left of the name column when the next
        // few data rows there are plain positive integers.
        if (empNoCol < 0 && nameCol > 0 && cells[nameCol - 1] === '') {
          const candidateCol = nameCol - 1
          const sample = rows
            .slice(i + 1, i + 6)
            .map((r) => (r as (string | number | null | undefined)[])[candidateCol])
            .filter((v) => v != null && String(v).trim() !== '')
          const looksNumeric =
            sample.length > 0 && sample.every((v) => /^\d+$/.test(String(v).trim()))
          if (looksNumeric) empNoCol = candidateCol
        }
        continue
      }

      // Haven't seen a header yet — skip
      if (sectionIdx < 0 || nameCol < 0) continue

      // Skip footer rows
      const first = cells[0].toLowerCase()
      if (first === 'total' || first === 'totals' || first === 'subtotal') continue

      const name = cells[nameCol]?.trim() ?? ''
      if (!name || name.length > 120) continue
      // Pure numbers aren't names
      if (/^[\d.,\s]+$/.test(name)) continue

      const lower = name.toLowerCase()
      if (seen.has(lower)) continue
      seen.add(lower)

      let employee_number: number | null = null
      if (empNoCol >= 0) {
        const raw = cells[empNoCol] ?? ''
        const n = parseInt(raw, 10)
        if (!isNaN(n) && n > 0) employee_number = n
      }

      out.push({
        name,
        role: ROLE_BY_SECTION[sectionIdx] ?? null,
        employee_number,
        confidence: 1,
        source_note: `${sheetName} section ${sectionIdx + 1}`,
      })
    }
  }

  return out
}
