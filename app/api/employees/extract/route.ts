import { NextRequest, NextResponse } from 'next/server'
import { extractEmployeesFromImage, isOpenAIConfigured, OpenAINotConfiguredError } from '@/lib/openai'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

type ExtractedEmployee = {
  name: string
  role: string | null
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

  if (kind === 'text') {
    const text = await file.text()
    const employees = parseTextEmployees(text)
    if (employees.length === 0) {
      return NextResponse.json(
        { error: 'No employee names found in this file. Expected one name per line, or a CSV with a name column.' },
        { status: 400 }
      )
    }
    return NextResponse.json({ employees })
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

  // Unsupported (PDF, Excel, etc.)
  return NextResponse.json(
    {
      error:
        kind === 'pdf'
          ? 'PDF uploads are not supported yet. Take a screenshot of the page or export it to CSV first.'
          : kind === 'excel'
          ? 'Excel uploads are not supported yet. In Excel: File → Save As → CSV, then re-upload.'
          : `Unsupported file type "${file.type || file.name}". Upload an image (JPG, PNG, HEIC), or a CSV / TSV / text file with one name per line.`,
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

const HEADER_TOKENS = new Set(['name', 'full name', 'employee', 'employee name', 'server', 'staff'])

function parseTextEmployees(text: string): ExtractedEmployee[] {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  if (lines.length === 0) return []

  const delim = detectDelimiter(lines)
  const seenLower = new Set<string>()
  const out: ExtractedEmployee[] = []

  for (let i = 0; i < lines.length; i++) {
    const cells = splitRow(lines[i], delim).map((c) => c.trim())
    if (cells.length === 0 || !cells[0]) continue

    if (i === 0 && HEADER_TOKENS.has(cells[0].toLowerCase())) continue // header row

    const name = cells[0]
    if (name.length > 120) continue
    const lower = name.toLowerCase()
    if (seenLower.has(lower)) continue
    seenLower.add(lower)

    const role = cells[1]?.trim() || null

    out.push({
      name,
      role: role && role.toLowerCase() !== 'role' ? role : null,
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
