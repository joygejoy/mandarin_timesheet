import { NextRequest, NextResponse } from 'next/server'
import { extractEmployeesFromImage, isOpenAIConfigured, OpenAINotConfiguredError } from '@/lib/openai'
import { pdfToText } from '@/lib/parsers/pdf'
import { xlsxToText } from '@/lib/parsers/excel'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

type ExtractedEmployee = {
  name: string
  role: string | null
  employee_number: number | null
  confidence: number
  source_note: string | null
}

export async function POST(request: NextRequest) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a "file" field.' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${Math.round(file.size / 1024 / 1024)} MB). Max 10 MB.` },
      { status: 413 }
    )
  }

  const kind = classifyFile(file)

  if (kind === 'text' || kind === 'pdf' || kind === 'excel') {
    let text = ''
    try {
      if (kind === 'text') {
        text = await file.text()
      } else if (kind === 'pdf') {
        const buf = Buffer.from(await file.arrayBuffer())
        text = await pdfToText(buf)
      } else if (kind === 'excel') {
        const buf = Buffer.from(await file.arrayBuffer())
        text = xlsxToText(buf)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to read file'
      return NextResponse.json({ error: msg }, { status: 400 })
    }

    const employees = parseTextEmployees(text)
    if (employees.length === 0) {
      return NextResponse.json(
        {
          error:
            kind === 'pdf'
              ? 'PDF was readable but no employee names were found. The roster might be in a layout the parser missed — try exporting to CSV.'
              : kind === 'excel'
              ? 'Excel file was readable but no employee names were found. Make sure the first column is the name.'
              : 'No employee names found in this file. Expected one name per line, or a CSV with a name column.',
        },
        { status: 400 }
      )
    }
    return NextResponse.json({ employees, source: kind })
  }

  if (kind === 'image') {
    if (!isOpenAIConfigured()) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY is not set in .env.local. Add it and restart the dev server.' },
        { status: 503 }
      )
    }
    const buf = Buffer.from(await file.arrayBuffer())
    try {
      const { employees } = await extractEmployeesFromImage({
        imageBase64: buf.toString('base64'),
        mimeType: file.type || 'image/jpeg',
      })
      return NextResponse.json({ employees })
    } catch (err) {
      if (err instanceof OpenAINotConfiguredError) {
        return NextResponse.json({ error: err.message }, { status: 503 })
      }
      const e = err as { status?: number; code?: string; message?: string }
      const status = typeof e.status === 'number' ? e.status : 502
      let message = e.message ?? 'Unknown OpenAI error'
      if (e.code === 'insufficient_quota') {
        message =
          'Your OpenAI account has no credits. Add a payment method and at least $5 in credits at https://platform.openai.com/settings/organization/billing.'
      } else if (e.code === 'invalid_api_key' || e.status === 401) {
        message = 'OpenAI rejected the API key. Check OPENAI_API_KEY in .env.local and restart the dev server.'
      }
      console.error('[employees/extract] OpenAI error:', e)
      return NextResponse.json({ error: message, code: e.code }, { status })
    }
  }

  // Unknown / unsupported
  return NextResponse.json(
    {
      error: `Unsupported file type "${file.type || file.name}". Supported: image (JPG/PNG/HEIC), CSV, TSV, TXT, PDF, XLS, XLSX.`,
    },
    { status: 415 }
  )
}

// ---- Helpers --------------------------------------------------------------

function classifyFile(file: File): 'image' | 'text' | 'pdf' | 'excel' | 'unknown' {
  const t = (file.type || '').toLowerCase()
  const name = (file.name || '').toLowerCase()
  if (t.startsWith('image/')) return 'image'
  if (
    t === 'text/csv' ||
    t === 'application/csv' ||
    t === 'text/plain' ||
    t === 'text/tab-separated-values' ||
    name.endsWith('.csv') ||
    name.endsWith('.tsv') ||
    name.endsWith('.txt')
  ) {
    return 'text'
  }
  if (t === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (
    t === 'application/vnd.ms-excel' ||
    t === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    name.endsWith('.xls') ||
    name.endsWith('.xlsx')
  ) {
    return 'excel'
  }
  return 'unknown'
}

const EMP_NO_HEADERS = new Set([
  'emp. no.',
  'emp no',
  'emp no.',
  'employee no',
  'employee no.',
  'employee number',
  'emp #',
  'emp#',
  'no.',
  '#',
  'id',
  'number',
])

// Header cells we recognize. Used both to detect a header row and to pick which
// column holds the name vs the role. Order inside each set doesn't matter.
const NAME_HEADERS = new Set([
  'name',
  'full name',
  'fullname',
  'employee',
  'employee name',
  "employee's name",
  'staff',
  'staff name',
  "staff's name",
  'server',
  "server's name",
  'first name',
  'person',
])
const ROLE_HEADERS = new Set(['role', 'position', 'title', 'job', 'job title'])
const RATE_HEADERS = new Set(['rate', 'hourly rate', 'hourly', 'pay rate', 'wage'])
const ANY_KNOWN_HEADER = new Set<string>([
  ...NAME_HEADERS,
  ...ROLE_HEADERS,
  ...RATE_HEADERS,
  // Extra columns that indicate a header row even when no NAME header is present.
  'emp. no.',
  'emp no',
  'emp no.',
  'employee no',
  'employee no.',
  'employee number',
  'id',
  'no.',
  'number',
  '#',
  'wk hr',
  '1st wk hr',
  '2nd wk hr',
  'meal',
  'break',
  'hours',
  'date',
])

// Remove emp-no headers from ANY_KNOWN_HEADER since we now track them in EMP_NO_HEADERS
// (they were duplicated there before). Keep them in the set for header detection.

// Things that look like rows but aren't people.
const SKIP_ROW_FIRST_CELL = new Set([
  'total',
  'totals',
  'subtotal',
  'sum',
  'grand total',
])

type ColumnLayout = {
  nameIdx: number
  roleIdx: number | null
  empNoIdx: number | null
}

function looksLikeHeader(cells: string[]): boolean {
  // A row is a header if at least one cell matches a known header token.
  for (const c of cells) {
    if (ANY_KNOWN_HEADER.has(c.toLowerCase())) return true
  }
  return false
}

function detectColumnLayout(headerCells: string[]): ColumnLayout {
  let nameIdx = -1
  let roleIdx: number | null = null
  let empNoIdx: number | null = null
  for (let i = 0; i < headerCells.length; i++) {
    const k = headerCells[i].toLowerCase().trim()
    if (nameIdx === -1 && NAME_HEADERS.has(k)) nameIdx = i
    else if (roleIdx === null && ROLE_HEADERS.has(k)) roleIdx = i
    if (empNoIdx === null && EMP_NO_HEADERS.has(k)) empNoIdx = i
  }
  return { nameIdx, roleIdx, empNoIdx }
}

const NUMERIC_RE = /^[\d.,\s$%-]+$/

function parseTextEmployees(text: string): ExtractedEmployee[] {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  if (lines.length === 0) return []

  const delim = detectDelimiter(lines)
  // Default layout: column 0 is the name, no role column. Updated as soon as
  // we see a header row.
  let layout: ColumnLayout = { nameIdx: 0, roleIdx: 1, empNoIdx: null }
  let sawHeader = false

  const seenLower = new Set<string>()
  const out: ExtractedEmployee[] = []

  for (let i = 0; i < lines.length; i++) {
    const cells = splitRow(lines[i], delim).map((c) => c.trim())
    if (cells.length === 0 || cells.every((c) => !c)) continue

    // Header row (could appear more than once in the same file — e.g. xlsx
    // exports of multi-section rosters with a header above each section).
    if (looksLikeHeader(cells)) {
      const detected = detectColumnLayout(cells)
      if (detected.nameIdx !== -1) {
        layout = detected
        sawHeader = true
      } else if (!sawHeader) {
        // Header without an explicit name column (e.g. "Emp. No., Staff's
        // Name, ..."). detectColumnLayout already handled "Staff's Name", so
        // this branch is rare — keep the default layout.
      }
      continue
    }

    // Skip footer-style rows ("TOTAL", "TOTALS", "Subtotal", ...).
    const firstCellLower = (cells[0] || '').toLowerCase()
    if (SKIP_ROW_FIRST_CELL.has(firstCellLower)) continue

    // Pull the name from the detected column. Fall back to the first non-empty
    // cell if that column is blank in this row.
    let name = (cells[layout.nameIdx] ?? '').trim()
    if (!name) {
      const firstNonEmpty = cells.find((c) => c.trim().length > 0)
      if (!firstNonEmpty) continue
      // Only fall back if it doesn't look like a number (employee ID, etc.).
      if (NUMERIC_RE.test(firstNonEmpty)) continue
      name = firstNonEmpty.trim()
    }
    if (!name || name.length > 120) continue
    // A pure number isn't a name (e.g. employee IDs in the wrong column).
    if (NUMERIC_RE.test(name)) continue

    const lower = name.toLowerCase()
    if (seenLower.has(lower)) continue
    seenLower.add(lower)

    let role: string | null = null
    if (layout.roleIdx != null) {
      const r = (cells[layout.roleIdx] ?? '').trim()
      if (r && r.toLowerCase() !== 'role') role = r
    }

    let employee_number: number | null = null
    if (layout.empNoIdx != null) {
      const raw = (cells[layout.empNoIdx] ?? '').trim()
      const n = parseInt(raw, 10)
      if (!isNaN(n) && n > 0) employee_number = n
    }

    out.push({
      name,
      role,
      employee_number,
      confidence: 1,
      source_note: `row ${i + 1}`,
    })

    if (out.length >= 500) break
  }

  return out
}

function detectDelimiter(lines: string[]): string {
  // Look at first 5 non-empty lines, count delimiter chars.
  const sample = lines.slice(0, 5).join('\n')
  const counts: Record<string, number> = {
    ',': (sample.match(/,/g) ?? []).length,
    '\t': (sample.match(/\t/g) ?? []).length,
    ';': (sample.match(/;/g) ?? []).length,
    '|': (sample.match(/\|/g) ?? []).length,
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return best && best[1] > 0 ? best[0] : '\n' // \n means one-name-per-line
}

function splitRow(line: string, delim: string): string[] {
  if (delim === '\n') return [line]
  // Naive CSV: handle simple quoted fields ("foo, bar")
  if (delim === ',') {
    const out: string[] = []
    let cur = ''
    let inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuote = !inQuote
        }
      } else if (ch === ',' && !inQuote) {
        out.push(cur)
        cur = ''
      } else {
        cur += ch
      }
    }
    out.push(cur)
    return out
  }
  return line.split(delim)
}
