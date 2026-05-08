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
  'dining room',
  'dining',
  'kitchen',
  'bar',
  'patio',
  'host',
  'host stand',
  'hostess',
  'hostess stand',
  'front',
  'front of house',
  'back',
  'back of house',
  'foh',
  'boh',
  'lobby',
  'counter',
  'takeout',
  'take out',
  'to go',
  'togo',
  'expo',
  'pass',
  'window',
  'room',
  'area',
  'station',
  'banquet',
  'grill',
  'grlil',
  'share',
  'shares',
  'driver',
  'hotel',
  'school',
])

// Common-noun room/area tokens. If every word in a candidate name is one of
// these, it's a section header, not a person.
const AREA_WORD_SET = new Set([
  'dining',
  'room',
  'kitchen',
  'bar',
  'patio',
  'host',
  'hostess',
  'stand',
  'front',
  'back',
  'house',
  'of',
  'foh',
  'boh',
  'lobby',
  'counter',
  'takeout',
  'togo',
  'expo',
  'pass',
  'window',
  'area',
  'station',
  'side',
  'main',
  'upstairs',
  'downstairs',
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

  // Drop candidates whose every token is a room/area word ("Dining Room",
  // "Front of House", "Bar Station", "Host Stand").
  const tokens = raw.toLowerCase().split(/[\s\-/]+/).filter(Boolean)
  if (tokens.length > 0 && tokens.every((t) => AREA_WORD_SET.has(t))) return false

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

THE SHEET HAS THESE COLUMNS FROM LEFT TO RIGHT (memorize this order — it is the most common source of error):
  Col 1: Section          (letter A-F, or words like "Busboy")
  Col 2: Server's Name
  Col 3: Schedule Time    → maps to output field  start_time      (the SHIFT START — the earliest time on the row)
  Col 4: Initial
  Col 5: Sign Out Time    → maps to output field  end_time        (the SHIFT END — the LATEST time on the row, written when the server clocked out)
  Col 6: Initial
  Col 7: Break Start Time → maps to output field  break_start_time (a time INSIDE the shift, when they went on break)
  Col 8: Initial
  Col 9: Break End Time   → maps to output field  break_end_time   (a time INSIDE the shift, when they came back from break)
  Col 10: Initial
  Col 11: Section Share   → IGNORE — never put this anywhere in output

CRITICAL — the most common mistakes the model makes:
- DO NOT confuse Sign Out Time (Col 5) with Break Start Time (Col 7). They are TWO COLUMNS APART, separated by an Initial column. Read by counting columns from the left.
- end_time is the time the server FINISHED their shift (last time on the row, usually evening or end-of-lunch).
- break_start_time is a time MID-SHIFT and is always between start_time and end_time.
- SANITY CHECK before outputting each row: end_time > start_time, AND if break_start_time and break_end_time are present, then start_time < break_start_time < break_end_time < end_time. If your reading violates this ordering, you mis-assigned a column — re-read.
- A row with only TWO times filled in (start + end, no break) is normal. Do NOT shift the second time leftward into break_start_time. It is end_time.

STICKY SECTION RULE — read this carefully (this is where the model frequently over-reaches):
- The Section column (Col 1) is sometimes sticky: the section letter is written ONCE at the top of a block and inherited by rows directly beneath it.
- BUT propagation stops the moment Col 1 contains ANY marking — a letter, a circled letter, a colored-ink letter, a scribble, a stamp, a tick. ANY visible mark in Col 1 means a NEW section starts on that row, even if the mark is messy or partly illegible. Do NOT inherit from above past such a mark.
- Section letters are often written in DIFFERENT INK COLORS (red, blue, black) and may be circled. Treat colored or circled letters as authoritative section labels — do not skip them just because they are in red or look decorative.
- Each horizontal "band" of the sheet (separated by repeated column-header rows: "Section | Server's Name | Schedule Time | …") has its OWN independent section letters. NEVER propagate a section letter across a band boundary.
- Sections do not skip alphabetically within a band: if you see A then C with no B label between them, B simply has no shifts — do NOT relabel C as B.
- If you genuinely cannot read Col 1 for a row (mark is present but unreadable), output the row with section: null and confidence ≤ 0.6 rather than inheriting from above.
- Only emit section: null when the row is outside any section block (rare).

NOTES FIELD RULE:
- The notes field is for FULL TEXTUAL annotations only: "no break, no meal", "1 meal", "15 min only", "lipa lisa", "tip-out cash". NEVER put a time value, a number alone, or a fragment in notes.
- If an annotation also drives a structured field (e.g. "1 meal" → meal_provided=true, "15 min only" → break_minutes=15, "no break" → break_minutes=0), DO NOT also copy the annotation into notes. The notes field is reserved for free-text observations the structured fields can't capture.
- NEVER put a sign-out time, break start, or break end into notes — those belong in their dedicated time fields.
- If you would output something less than 3 characters or a single fragment ("1 n", "no", "8:", "Le"), output null instead — it's noise.

DIGIT DISCIPLINE (8 vs 9, propagation, etc.):
- Bracket-target times are written ONCE and apply to multiple rows. A single misread propagates to every row in the bracket — so be especially careful with these. When in doubt, lower confidence on every row in the bracket rather than guessing.
- Distinguish 8 from 9 by counting closed loops. An "8" has TWO closed loops stacked vertically. A "9" has ONE closed loop with a tail/stem going down (or curving). If you see two loops, it's an 8 — even if the handwriting is slanted, slim, or messy.
- Distinguish 0 from 6, 1 from 7, 3 from 8 with the same care: count loops and trace the stem direction.
- Restaurant dinner shifts can end anywhere between roughly 20:00 and 23:30. Do NOT bias toward later times — 8:30 PM and 9:30 PM are both common end-times. Read the digit; do not guess.
- If you have ANY uncertainty between 8 and 9 (or any other adjacent digit pair) on a bracket-target time, set confidence ≤ 0.6 on every row in that bracket. The manager will spot-check those rows.

Other rules:
- ALL times in 24-hour "HH:MM" format. Restaurant context: a written "4:30" with no AM/PM means 16:30 unless context proves otherwise (e.g. lunch sheet morning shifts where 4:30 is impossible).
- Bracket notation: a curly brace or vertical line connecting multiple rows to ONE end-time means that end-time applies to every row in the bracket. Apply the time to each row AND set inferred_from_bracket=true on those rows. The row where the bracket STARTS gets the same time as the rows below it.
- "NO BREAK NO MEAL" (or "no break", "no meal", "NO BRK", "n/b") written across multiple rows applies to every row underneath the annotation: set break_minutes=0, break_start_time=null, break_end_time=null, meal_provided=false, and put "no break, no meal" in the notes field.
- IMPORTANT: When a row says "no break" anywhere across its break columns (even just a single "NO BRK" scribble), the row has NO break. Do NOT extract any times from that row's break columns — set break_start_time=null, break_end_time=null, break_minutes=0. NEVER hallucinate break times for a row that says no break.
- "Sign", "Sign Out", "S/O", or "SO" written before a time (e.g. "Sign 3:30", "S/O 4:00") indicates a SIGN-OUT TIME. That time goes in end_time, NEVER in break_start_time or break_end_time. If you see "Sign 3:30" in the break-columns area, the writer ran out of room in the Sign Out column — the time still belongs in end_time.
- "1 meal" or "meal" handwritten in a row means meal_provided=true.
- "15 min only" or similar means break_minutes=15 (or as written) regardless of break_start/end times.
- IGNORE manager approval signatures (large diagonal handwriting like "LISA" in red across cells). Capture the manager name in approved_by_signature and do NOT create a shift row for it.
- IGNORE dollar amounts written in section-share area or floating in margins.
- Cross-outs and strikethroughs: skip those rows entirely OR mark confidence < 0.5 if unsure.
- Same person may appear multiple times on one sheet (different sections or split shifts) — that's fine, emit one row per occurrence.
- For each shift compute break_minutes from break_start_time and break_end_time when both are present (else 0).
- Confidence: 1.0 = clearly readable; 0.7-0.9 = mostly readable, one field is fuzzy; below 0.6 = guessing. If you had to violate the sanity check above and aren't sure, lower confidence to 0.5.

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
  for (const shift of parsed.shifts ?? []) {
    if (!hasConsistentTimes(shift)) {
      shift.confidence = Math.min(shift.confidence, 0.4)
    }
    shift.notes = cleanNotes(shift.notes)
  }
  return { sheet: parsed, raw: response }
}

// Drops noise the model sometimes drops into the notes field: short fragments,
// time-like strings, single-letter junk, lone numbers. Keeps real annotations
// like "no break, no meal", "1 meal", "15 min only", "lipa lisa".
function cleanNotes(raw: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (trimmed.length < 3) return null
  // Pure number, optionally with a single trailing letter ("1 n", "15 m", "8").
  if (/^\d+\s*[a-z]?\s*$/i.test(trimmed)) return null
  // A time fragment (e.g. "8:30", "08:0", "10:").
  if (/^\d{1,2}:\d{0,2}$/.test(trimmed)) return null
  return trimmed
}

// Returns false if the times on a row violate the natural ordering
// start < (break_start < break_end) < end. Used to flag rows where the model
// likely confused the Sign Out column with the Break Start column.
function hasConsistentTimes(s: ExtractedShift): boolean {
  const toMin = (t: string | null): number | null => {
    if (!t) return null
    const m = /^(\d{1,2}):(\d{2})$/.exec(t)
    if (!m) return null
    return Number(m[1]) * 60 + Number(m[2])
  }
  const start = toMin(s.start_time)
  const end = toMin(s.end_time)
  const bs = toMin(s.break_start_time)
  const be = toMin(s.break_end_time)
  if (start != null && end != null && end <= start) return false
  if (bs != null && be != null && be <= bs) return false
  if (bs != null && start != null && bs < start) return false
  if (bs != null && end != null && bs >= end) return false
  if (be != null && start != null && be <= start) return false
  if (be != null && end != null && be > end) return false
  return true
}
