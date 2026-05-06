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

const EXTRACTION_SYSTEM = `You read photos of restaurant daily sign-in/out sheets and pull out the distinct STAFF MEMBER NAMES (people who work at the restaurant). Nothing else.

A name is a person's first name, optionally with a last name or last initial. Examples of valid names: "Lisa", "Donny", "Anna B", "Yoomi", "Raymond".

NEVER include any of the following — they are NOT names:
- Time values: "4:30", "8:00", "16:30", "10:00 PM"
- Initials in initial columns: "PL", "DW", "ZK", "AL", "SK", "LF" (these are 1-3 letter abbreviations next to time columns)
- Annotations: "NO BREAK", "NO MEAL", "no break", "no meal", "1 meal", "15 min only"
- Section labels alone: "A", "B", "C", "D", "E", "F", "Busboy"
- Column headers: "Date", "Section", "Server's Name", "Schedule Time", "Initial", "Sign Out Time", "Break Start Time", "Break End Time", "Section Share", "Lunch", "Dinner"
- Manager approval signatures: a name written diagonally in a different ink color (e.g. red "LISA") spanning multiple cells is a SIGN-OFF, not a roster entry — skip it.
- Dollar amounts: "$375", "5.0", "$"
- Cross-outs / strikethroughs: skip those entirely.
- Generic role labels alone: "Server", "Bartender", "Manager", "Busboy" (when not part of a name).

Rules for output:
- Return ONE entry per distinct person, even if their name appears in multiple rows or sections.
- Deduplicate aggressively: "Lisa", "Lisa F", and "LisaFn" are the same person — pick the most complete spelling.
- For role: if the section label indicates the role (e.g. the person was found in a "Busboy" section), set role to that. Otherwise leave role null. Do not guess generic roles like "Server" — leave null.
- Confidence: 1.0 if the name is clearly printed/written, 0.7-0.9 if partially smudged or hard to read, below 0.6 only if you're truly guessing. If your confidence would be below 0.5, OMIT the entry entirely rather than guessing.
- source_note: a brief hint of where you saw them (e.g. "Section A row 1", "Busboy section").

If in doubt about whether a string is a name or a label/annotation, OMIT it. False negatives are recoverable (the manager can add the missing name); false positives create cleanup work. Be conservative.

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
  const filtered = (parsed.employees ?? []).filter(isPlausibleName)
  return { employees: filtered, raw: response }
}

// Words/phrases that the model occasionally emits as "names" but never are.
// Compared case-insensitively against the trimmed name.
const NON_NAME_BLOCKLIST = new Set([
  'no break',
  'no meal',
  'no break no meal',
  'no break, no meal',
  '1 meal',
  '15 min',
  '15 min only',
  'meal',
  'break',
  'lunch',
  'dinner',
  'lunch/dinner',
  'busboy',
  'server',
  'bartender',
  'manager',
  'date',
  'section',
  'section share',
  "server's name",
  'servers name',
  'schedule time',
  'sign out time',
  'break start time',
  'break end time',
  'initial',
  'initials',
  'time',
  'name',
  'role',
])

const TIME_RE = /^\d{1,2}[:.]?\d{0,2}\s*(am|pm)?$/i
const ALL_PUNCT_RE = /^[\s\W_]+$/
const ALL_DIGITS_RE = /^[\d.,$\s]+$/

function isPlausibleName(e: { name: string }): boolean {
  const raw = (e.name ?? '').trim()
  if (raw.length < 2 || raw.length > 60) return false
  if (NON_NAME_BLOCKLIST.has(raw.toLowerCase())) return false
  if (ALL_PUNCT_RE.test(raw)) return false
  if (ALL_DIGITS_RE.test(raw)) return false
  if (TIME_RE.test(raw)) return false

  // Single section letter ("A", "B"…) or all-caps initials block ("PL", "DW", "SK").
  // Two-to-three uppercase letters with no vowel are almost always initials.
  if (/^[A-Z]{1,3}$/.test(raw) && !/[AEIOUY]/.test(raw)) return false

  // Must contain at least one letter.
  if (!/[A-Za-z]/.test(raw)) return false

  return true
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
  roster?: { name: string; role?: string | null }[]
}): Promise<{ sheet: ExtractedSheet; raw: unknown }> {
  const client = getOpenAI()
  const dataUrl = `data:${args.mimeType};base64,${args.imageBase64}`

  // When we have a roster, inject it so the model anchors on canonical
  // spellings instead of guessing at messy handwriting.
  const rosterBlock =
    args.roster && args.roster.length > 0
      ? '\n\nCURRENT ROSTER (prefer these exact spellings when matching handwriting):\n' +
        args.roster
          .map((e) => `- ${e.name}${e.role ? ` (${e.role})` : ''}`)
          .join('\n') +
        '\nIf a name on the sheet plausibly matches one of these (case-insensitive, allowing for nicknames or partial spellings like "Lisa" / "LisaFn" / "Lisa F"), output the canonical spelling from the roster. If you genuinely cannot match, use the literal handwriting.'
      : ''

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
      { role: 'system', content: SHIFT_EXTRACTION_SYSTEM + rosterBlock },
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
