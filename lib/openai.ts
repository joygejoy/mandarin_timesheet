import 'server-only'
import OpenAI from 'openai'

let _client: OpenAI | null = null

export function getOpenAI(): OpenAI {
  if (_client) return _client
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new OpenAINotConfiguredError()
  _client = new OpenAI({ apiKey: key })
  return _client
}

export function isOpenAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY)
}

export class OpenAINotConfiguredError extends Error {
  constructor() {
    super('OpenAI is not configured. Add OPENAI_API_KEY to .env.local.')
    this.name = 'OpenAINotConfiguredError'
  }
}

// ---- Employee extraction --------------------------------------------------

export type ExtractedEmployee = {
  name: string
  role: string | null
  /** 0..1, model's self-reported confidence */
  confidence: number
  /** Where on the sheet this was found, model's words (e.g. "Section A", "Busboy row") */
  source_note: string | null
}

const EXTRACTION_SYSTEM = `You read photos of restaurant daily sign-in/out sheets and pull out the distinct staff members listed on the sheet.

Rules:
- Return ONE entry per distinct person, even if their name appears in multiple rows or sections.
- Deduplicate aggressively: "Lisa", "Lisa F", and "LisaFn" are the same person — pick the most complete spelling.
- Ignore manager approval signatures (e.g. red "LISA" written diagonally across cells) — those are signoffs, not staff entries on this sheet.
- Ignore time values, initials, "no break / no meal" notes, dollar totals, and section letters.
- For role: if the section label indicates the role (e.g. "Busboy" section), set role to that. Otherwise leave role null. Do not guess generic roles like "Server" — leave null.
- Confidence: 1.0 if the name is clearly printed/written, 0.6-0.8 if partially smudged or hard to read, lower if you're guessing.
- source_note: a brief hint of where you saw them (e.g. "Section A row 1", "Busboy section").

Output strictly the JSON schema requested.`

export async function extractEmployeesFromImage(args: {
  imageBase64: string
  mimeType: string
}): Promise<{ employees: ExtractedEmployee[]; raw: unknown }> {
  const client = getOpenAI()
  const dataUrl = `data:${args.mimeType};base64,${args.imageBase64}`

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'employee_extraction',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['employees'],
          properties: {
            employees: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'role', 'confidence', 'source_note'],
                properties: {
                  name: { type: 'string', description: 'Best spelling of the person\'s name.' },
                  role: { type: ['string', 'null'], description: 'Role if obvious from section label, else null.' },
                  confidence: { type: 'number', minimum: 0, maximum: 1 },
                  source_note: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
      },
    },
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract every distinct staff member listed on this sign-in sheet.' },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        ],
      },
    ],
  })

  const text = response.choices[0]?.message?.content ?? '{}'
  let parsed: { employees?: ExtractedEmployee[] }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`OpenAI returned invalid JSON: ${text.slice(0, 200)}`)
  }
  return { employees: parsed.employees ?? [], raw: response }
}

// ---- Shift extraction (full daily sheet) ---------------------------------

export type ExtractedShift = {
  section: string | null
  employee_name: string
  start_time: string | null         // "HH:MM" 24-hour
  end_time: string | null
  break_start_time: string | null
  break_end_time: string | null
  break_minutes: number             // computed by the model when start/end given
  meal_provided: boolean
  initials: string | null
  notes: string | null
  confidence: number                // 0..1 self-reported
  /** True when the model copied this row's end-time from a bracket spanning
   * multiple rows (so the manager knows to spot-check). */
  inferred_from_bracket: boolean
}

export type ExtractedSheet = {
  date_iso: string | null           // "YYYY-MM-DD" if visible on the sheet
  date_text: string | null          // model's literal reading (e.g. "Mon Apr 1")
  shift_type: 'lunch' | 'dinner' | 'both' | null
  approved_by_signature: string | null
  notes: string | null              // "$375 section share", "lipa lisa", etc.
  shifts: ExtractedShift[]
}

const SHIFT_EXTRACTION_SYSTEM = `You read photos of restaurant daily sign-in/out sheets and extract one row per worked shift.

The sheet has these columns from left to right:
- Date (top of page; usually a weekday + month/day; "Lunch" or "Dinner" is circled)
- Section (letter A-F or words like "Busboy")
- Server's Name
- Schedule Time (start time)
- Initial (next to schedule time)
- Sign Out Time (end time)
- Initial
- Break Start Time
- Initial
- Break End Time
- Initial
- Section Share (IGNORE THIS COLUMN — do not include it in output)

Rules:
- ALL times in 24-hour "HH:MM" format. Restaurant context: a written "4:30" with no AM/PM means 16:30 unless context proves otherwise (e.g. lunch sheet morning shifts).
- Bracket notation: a curly brace or vertical line connecting multiple rows to ONE end-time means that end-time applies to every row in the bracket. Apply the time to each row AND set inferred_from_bracket=true on those rows.
- "NO BREAK NO MEAL" (or "no break", "no meal") written across multiple rows applies to every row underneath the annotation: set break_minutes=0, break_start_time=null, break_end_time=null, meal_provided=false, and put "no break, no meal" in the notes field.
- "1 meal" or "meal" handwritten in a row means meal_provided=true.
- "15 min only" or similar means break_minutes=15 (or as written) regardless of break_start/end times.
- IGNORE manager approval signatures (large diagonal handwriting like "LISA" in red across cells). Capture the manager name in approved_by_signature and do NOT create a shift row for it.
- IGNORE dollar amounts written in section-share area or floating in margins.
- Cross-outs and strikethroughs: skip those rows entirely OR mark confidence < 0.5 if unsure.
- Same person may appear multiple times on one sheet (different sections or split shifts) — that's fine, emit one row per occurrence.
- For each shift compute break_minutes from break_start_time and break_end_time when both are present (else 0).
- Confidence: 1.0 = clearly readable; 0.7-0.9 = mostly readable, one field is fuzzy; below 0.6 = guessing.

Output strictly the JSON schema requested.`

export async function extractShiftsFromImage(args: {
  imageBase64: string
  mimeType: string
}): Promise<{ sheet: ExtractedSheet; raw: unknown }> {
  const client = getOpenAI()
  const dataUrl = `data:${args.mimeType};base64,${args.imageBase64}`

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'sheet_extraction',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['date_iso', 'date_text', 'shift_type', 'approved_by_signature', 'notes', 'shifts'],
          properties: {
            date_iso: { type: ['string', 'null'] },
            date_text: { type: ['string', 'null'] },
            shift_type: { type: ['string', 'null'], enum: ['lunch', 'dinner', 'both', null] },
            approved_by_signature: { type: ['string', 'null'] },
            notes: { type: ['string', 'null'] },
            shifts: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: [
                  'section',
                  'employee_name',
                  'start_time',
                  'end_time',
                  'break_start_time',
                  'break_end_time',
                  'break_minutes',
                  'meal_provided',
                  'initials',
                  'notes',
                  'confidence',
                  'inferred_from_bracket',
                ],
                properties: {
                  section: { type: ['string', 'null'] },
                  employee_name: { type: 'string' },
                  start_time: { type: ['string', 'null'] },
                  end_time: { type: ['string', 'null'] },
                  break_start_time: { type: ['string', 'null'] },
                  break_end_time: { type: ['string', 'null'] },
                  break_minutes: { type: 'number', minimum: 0, maximum: 480 },
                  meal_provided: { type: 'boolean' },
                  initials: { type: ['string', 'null'] },
                  notes: { type: ['string', 'null'] },
                  confidence: { type: 'number', minimum: 0, maximum: 1 },
                  inferred_from_bracket: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    messages: [
      { role: 'system', content: SHIFT_EXTRACTION_SYSTEM },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract every shift on this daily sign-in/out sheet. Apply the rules above strictly.',
          },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        ],
      },
    ],
  })

  const text = response.choices[0]?.message?.content ?? '{}'
  let parsed: ExtractedSheet
  try {
    parsed = JSON.parse(text) as ExtractedSheet
  } catch {
    throw new Error(`OpenAI returned invalid JSON: ${text.slice(0, 200)}`)
  }
  return { sheet: parsed, raw: response }
}
