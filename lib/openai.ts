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

PHOTO ORIENTATION — CHECK THIS BEFORE READING ANY COLUMNS:
- These sheets are sometimes photographed rotated 90° left (counterclockwise) or 90° right (clockwise). Before mapping any columns, determine whether the sheet is portrait-upright.
- A correctly oriented sheet has the column headers ("Section | Server's Name | Schedule Time …") running LEFT-TO-RIGHT across the top, and the rows running DOWN the page.
- If the headers run top-to-bottom (text reads sideways), the photo is rotated. Mentally rotate it upright before parsing. The column order rule still applies exactly — just re-orient your reading direction first.
- If part of the sheet is skewed or has perspective distortion (photographed flat on a table at an angle), columns near the far edge may drift. When a time value near the right edge is ambiguous between two adjacent columns, lower confidence to ≤ 0.6 and note the ambiguity.
- If you cannot determine the correct orientation, output all shifts with confidence ≤ 0.5 and add "orientation unclear" to the sheet-level notes field.

NEVER SKIP A NAME ROW — this is the most critical rule:
- Every row that contains a person's name in the Name column MUST produce exactly one output entry, even if all other columns (start_time, end_time, break times) are blank or unreadable.
- Do NOT silently omit rows because they are hard to read, partially crossed out, or have missing data. Instead: include the row with null for missing fields and set confidence ≤ 0.5.
- After you finish extracting, mentally count the name rows you can see on the sheet. If your output count is lower than your visual count, you missed someone — re-read the sheet and add the missing rows before outputting.
- Only skip a row if:
    a) The name cell is completely empty (no name at all — not even a partial letter or initial), OR
    b) The row is a column-header row ("Server's Name", "Schedule Time", etc.), OR
    c) The entire row is struck through (see CROSSED-OUT ROWS rule below), OR
    d) The name cell contains only a pre-printed dash, diagonal line, or slash mark with no handwritten name overlaid.
- Rows that have a name but all-blank time fields: INCLUDE with all time fields null and confidence ≤ 0.5.
- Entirely empty section bands (a header row exists but zero name rows are filled in beneath it): emit nothing — do not output placeholder rows. These are unused template bands.

OUTPUT ORDER (read this first — it is non-negotiable):
- Return the shifts in the EXACT top-to-bottom order they appear on the sheet, row by row, left band before right band when bands are side-by-side, top band before bottom band when bands stack vertically.
- DO NOT alphabetize. DO NOT group by section. DO NOT sort by start_time. The manager reviews the output side-by-side with the photo and needs the rows to line up visually.
- If the sheet has a blank row (no name), skip it (don't emit a placeholder); the next row continues the order.


THE SHEET HAS THESE COLUMNS FROM LEFT TO RIGHT (memorize this order — it is the most common source of error):
  Col 1: Section          (always a single letter A–F. No other value is valid — output null for any row where a clear A–F letter cannot be read. IMPORTANT: managers often write their initials or a verification mark BESIDE the section letter as a check-off — e.g. "TIE A", "IF B", "T C". These prefixes are initials, not section codes. Ignore them and output only the single letter A–F that follows. NOTE: the bottom of the sheet sometimes has a row labeled "Busboy" or "Bus" — this identifies the employee's role, NOT a section. Output section = null for those rows.)
  Col 2: Server's Name
  Col 3: Schedule Time    → maps to output field  start_time      (the SHIFT START — the earliest time on the row)
  Col 4: Initial
  Col 5: Sign Out Time    → maps to output field  end_time        (the SHIFT END — the LATEST time on the row, written when the server clocked out)
  Col 6: Initial
  Col 7: Break Start Time → maps to output field  break_start_time (a time INSIDE the shift, when they went on break)
  Col 8: Initial
  Col 9: Break End Time   → maps to output field  break_end_time   (a time INSIDE the shift, when they came back from break)
  Col 10: Initial
  Col 11: Section Share   → IGNORE as a data field (never extract a dollar amount or percentage from it). EXCEPTION: if the text written in this column is a break/meal annotation ("No Meal", "No Break", "no break no meal"), treat it as applying to that row and process it like any other annotation.

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
- Section letters are always A–F (single character). Never output anything else — no compound codes, no role labels, no manager initials.
- "Busboy" or "Bus" appearing in Col 1 identifies the employee's role, not a section. Output section = null for those rows and read Col 2 as the employee name normally. Busboy rows follow all the same output rules as server rows.
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

TIME FORMAT — read this before outputting any time:
- ALL times in 24-hour "HH:MM" format. Pad single digits to two ("9:30" → "09:30").
- Restaurants don't use AM/PM markers on these sheets. You must INFER AM/PM from the column and the shift_type. Use these defaults:
    * shift_type = "lunch":   start_time is 09:00–12:30 (AM), end_time is 13:00–17:00 (1 PM – 5 PM).
    * shift_type = "dinner":  start_time is 15:00–18:00 (3 PM – 6 PM), end_time is 19:00–23:30 (7 PM – 11:30 PM).
    * shift_type = "both":    apply per-band inference — see MULTI-BAND SHEETS section below.
- Concrete EXAMPLES (apply to every shift, both lunch and dinner sheets):
    * Dinner sheet, written "4:30" in the start column → 16:30.  NEVER 04:30 unless the sheet is explicitly an overnight/early shift.
    * Dinner sheet, written "9" or "9:00" in the end column → 21:00.  NEVER 09:00.
    * Dinner sheet, written "10:30" in the end column → 22:30.  NEVER 10:30 AM.
    * Lunch sheet, written "10:00" in the start column → 10:00 (already AM).
    * Lunch sheet, written "2:30" in the end column → 14:30.  NEVER 02:30.
    * "11:00" in the start column on a dinner sheet is ambiguous — prefer 11:00 (AM) only if other rows on the sheet also start in the morning, otherwise 23:00 is wrong (no shift starts at 11 PM). When in doubt for an 11:xx start, output 11:xx (AM).
- SANITY CHECK on every row: end_time MUST be later than start_time, and the gap MUST be between 2 and 14 hours (inclusive). If your reading violates this, you mis-assigned AM/PM somewhere — fix it before outputting.
- If after fixing AM/PM the ordering still doesn't make sense, lower the row's confidence to ≤ 0.5 — don't emit nonsense.

EXPLICIT AM/PM OVERRIDE:
- If a time is written with an explicit "am", "AM", "pm", or "PM" suffix (e.g. "9:35pm", "10:45 AM", "8:30pm"), treat that suffix as authoritative. Convert using the written suffix, ignoring the shift_type inference rule entirely for that cell.
- "9:35pm" → 21:35. "10:45 AM" → 10:45. "8:30pm" → 20:30. "5:00pm" → 17:00.
- If an explicit suffix conflicts with shift_type inference AND the result still makes structural sense (end > start, gap 2–14 hours), trust the explicit suffix. If the result is nonsensical, lower confidence to ≤ 0.5 and emit the explicitly-written value anyway.
- Times written without any suffix are still governed by the shift_type inference rules above.

NON-STANDARD TIME FORMATS:
- Times written without a colon (e.g. "850", "930", "1030"): interpret as HH:MM by inserting a colon before the last two digits — "850" → "8:50" → apply AM/PM inference. "1030" → "10:30".
- Times with non-numeric text appended (e.g. "7:30 PC", "3:00 PC", "8:45 SO"): strip the text suffix, use only the numeric time. Do NOT let the suffix contaminate the time value.
- "30 mins break", "30 min break", "30 break", "30min": treat as break_minutes=30. Set break_start_time=null, break_end_time=null.
- Labels like "Job 3:50", "No Club 66" in time columns: these are annotation text, not times. Extract the numeric portion only if it clearly represents a clock time in context; otherwise output null for that time field and put the full text in notes.
- Impossible times (e.g. "3:60"): flag by setting confidence ≤ 0.5 and outputting the nearest plausible time with a note "unreadable time — guessed".

MULTI-BAND SHEETS AND PER-BAND SHIFT_TYPE:
- A "band" is one set of rows bounded above and below by a full column-header row ("Section | Server's Name | Schedule Time | Initial | Sign Out Time …"). Each repeated header row marks the start of a new band.
- When shift_type = "both" (or when you see "Lunch / Dinner" in the header), infer shift_type per band independently:
    * For each band, look at the start_time values actually written in the Schedule Time column. If those times cluster in 09:00–12:30, that band is a lunch band. If they cluster in 15:00–18:00, it is a dinner band.
    * Apply the corresponding AM/PM inference rules only to rows within that band.
    * If a band's start times are ambiguous or blank, treat it as dinner if it is the lower band on the sheet, lunch if it is the upper band — this matches the typical physical layout.
- Section letter sticky inheritance NEVER crosses a band boundary. Reset at every header row.
- Completely empty bands (a header row exists but no name rows are filled in beneath it) produce zero output rows. Do not emit placeholder rows for empty bands.
- Sheets may have more than two bands (up to 4–5 have been observed). Do not assume exactly two bands.

BRACKET NOTATION — all visual forms:
- Bracket notation means ONE time value applies to MULTIPLE rows. Recognize ALL of the following visual forms as bracket notation:
    1. A curly brace ( { or } ) connecting rows on the left or right side of a column.
    2. A vertical line or bar connecting rows (may be a straight pencil line, not a printed brace).
    3. A right-pointing arrow (">" or "→") next to a time value, with rows above/below it — the arrow points to the time that all those rows share.
    4. A time value written in very large or oversized numerals spanning multiple rows in a single column (the large size signals it applies to all rows it covers, not just one).
    5. Any line, mark, or visual grouping that clearly connects multiple rows to a single time value.
- Bracket notation can appear in ANY time column: Schedule Time (start), Sign Out Time (end), Break Start, or Break End. Apply the bracketed value to the correct column based on which column the bracket appears in.
- IMPORTANT: the row where the bracket STARTS gets the SAME time as the rows below it. Do NOT leave the first bracket row blank. Do NOT shift the bracket up or down by one row.
- Apply inferred_from_bracket=true on every row that received its time value from bracket notation.
- Bracket span size is unlimited — a bracket may span 2 rows or 6+ rows. Determine the span by the physical extent of the bracket mark.
- When in doubt about which rows a bracket covers (e.g. photo angle distortion), lower confidence to ≤ 0.6 on all candidate rows.

BREAK/MEAL ANNOTATIONS — all variants:
- The authoritative annotation forms are: "NO BREAK NO MEAL", "NO BREAK", "NO MEAL", "no break", "no meal", "NO BRK", "N/B", "NB", "NB/NM", "NOBR", and any abbreviation or stylized form (e.g. "NOBR2ME", "NOBRZMAL") that contains "no" + "break" or "meal" keywords. Match case-insensitively.
- When ANY of these appear with the word "ALL" or "All" prefix (e.g. "ALL NO BREAK NO MEAL", "All No Break", "3:15 All No Break No Meal", "10:30 All No Break No Meal"), the annotation is BAND-WIDE: apply it to every single row in the current band (all rows between this band's header row and the next band's header row).
- When the same annotation appears WITHOUT "All" but spans multiple rows visually (written in large text physically covering multiple rows, written diagonally, or written alongside a bracket), it still applies to every row it visually covers — not just the row it starts on.
- "NO BREAK" alone (without "NO MEAL"): set break_start_time=null, break_end_time=null, break_minutes=0. Leave meal_provided unchanged.
- "NO MEAL" alone (without "NO BREAK"): set meal_provided=false. Do not modify break fields.
- Combined "NO BREAK NO MEAL" (any order, any abbreviation): set break_start_time=null, break_end_time=null, break_minutes=0, meal_provided=false.
- When a large annotation physically covers an area where time values might otherwise be written, treat those covered time fields as absent — output null. Do NOT guess or hallucinate times from beneath the annotation text.
- Put the annotation in the row's notes field as: "no break, no meal" / "no break" / "no meal" as appropriate.
- Exclamation marks and punctuation (e.g. "No Break!!!", "no meal!!!") do not change the meaning — treat identically.
- Slash-compound abbreviations like "NB/NM", "N/B", "NB/Nomeal", "W/N", "B/S": "NB" = no break, "NM" = no meal, "N/B" = no break. "W/N" alone is ambiguous — if context confirms it means "without break/meal" apply accordingly; otherwise output it as a note.
- "NO SHOW" or "no show" written in a row means the employee was scheduled but did not arrive. Output the row with start_time=null, end_time=null, all break fields null, break_minutes=0, and notes="no show". Do NOT skip the row.
- IMPORTANT: When a row says "no break" anywhere across its break columns, the row has NO break. Do NOT extract any times from that row's break columns — set break_start_time=null, break_end_time=null, break_minutes=0. NEVER hallucinate break times for a row that says no break.

CROSSED-OUT ROWS AND CORRECTIONS:
- If an entire row (name + all fields) is visibly struck through with a single line or X, SKIP that row entirely — the manager cancelled that entry.
- If only a specific field value is crossed out with a correction written above or beside it (e.g. a corrected time), use the REPLACEMENT value, not the original. Set confidence ≤ 0.7 and note "corrected value used" only if it is ambiguous which is the correction.
- If a name is partially crossed out but the row otherwise has valid data, INCLUDE the row with the best-readable name, confidence ≤ 0.5, and a note "name partially struck through."
- When you cannot tell whether a mark is a strikethrough or a handwriting artifact, include the row with confidence ≤ 0.5.

Other rules:
- "Sign", "Sign Out", "S/O", or "SO" written before a time (e.g. "Sign 3:30", "S/O 4:00") indicates a SIGN-OUT TIME. That time goes in end_time, NEVER in break_start_time or break_end_time. If you see "Sign 3:30" in the break-columns area, the writer ran out of room in the Sign Out column — the time still belongs in end_time.
- "1 meal" or "meal" handwritten in a row means meal_provided=true.
- "15 min only" or similar means break_minutes=15 (or as written) regardless of break_start/end times.
- IGNORE manager approval signatures (large diagonal handwriting like "LISA" in red across cells). Capture the manager name in approved_by_signature and do NOT create a shift row for it.
- IGNORE dollar amounts written in section-share area or floating in margins.
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
    fixObviousAmPmConfusion(shift, parsed.shift_type)
    if (!hasConsistentTimes(shift)) {
      shift.confidence = Math.min(shift.confidence, 0.4)
    }
    shift.notes = cleanNotes(shift.notes)
  }
  return { sheet: parsed, raw: response }
}

// The model occasionally outputs "04:30" when the sheet clearly shows "4:30 PM"
// (16:30) and vice versa, despite the prompt rules. We can fix the obvious
// cases server-side using two signals:
//   1. shift_type tells us the typical hour windows (lunch vs dinner).
//   2. start < end and (end - start) ∈ [2h, 14h] is the only sensible result.
// If a row's times violate (2) but become consistent after flipping the
// AM/PM half on start_time and/or end_time, apply the flip and lower
// confidence so the manager double-checks.
function fixObviousAmPmConfusion(
  s: ExtractedShift,
  sheetType: ExtractedSheet['shift_type']
): void {
  const start = parseHHMM(s.start_time)
  const end = parseHHMM(s.end_time)
  if (start == null || end == null) return

  const flip = (mins: number): number => (mins < 12 * 60 ? mins + 12 * 60 : mins - 12 * 60)
  const plausible = (a: number, b: number): boolean => {
    if (b <= a) return false
    const span = b - a
    return span >= 2 * 60 && span <= 14 * 60
  }
  const fitsType = (a: number, b: number): boolean => {
    if (sheetType === 'lunch') {
      // Lunch shifts: starts 9–13, ends 13–17.
      return a >= 9 * 60 && a <= 13 * 60 && b >= 13 * 60 && b <= 17 * 60
    }
    if (sheetType === 'dinner') {
      // Dinner shifts: starts 14–19, ends 18–24.
      return a >= 14 * 60 && a <= 19 * 60 && b >= 18 * 60 && b <= 24 * 60
    }
    // 'both' or null — accept any plausible window.
    return true
  }

  // If the row already makes sense, leave it alone.
  if (plausible(start, end) && fitsType(start, end)) return

  // Try the four possible AM/PM flips and pick the one that fits the sheet
  // type best, falling back to "just plausible" if no candidate fits.
  const candidates: { start: number; end: number; flips: number }[] = [
    { start, end, flips: 0 },
    { start: flip(start), end, flips: 1 },
    { start, end: flip(end), flips: 1 },
    { start: flip(start), end: flip(end), flips: 2 },
  ]
  const fitting = candidates.find((c) => plausible(c.start, c.end) && fitsType(c.start, c.end))
  const best = fitting ?? candidates.find((c) => plausible(c.start, c.end))
  if (!best || best.flips === 0) return

  s.start_time = formatHHMM(best.start)
  s.end_time = formatHHMM(best.end)
  s.confidence = Math.min(s.confidence, 0.6)
  s.inferred_from_bracket = true // flag for review even if it wasn't originally
}

function parseHHMM(t: string | null): number | null {
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(t)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

function formatHHMM(mins: number): string {
  const h = Math.floor(mins / 60) % 24
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
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
