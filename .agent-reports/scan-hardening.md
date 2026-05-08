# Scan flow hardening — agent report

> Session date: 2026-05-07. Iterated on the daily-sheet OCR review flow after
> a series of real-photo failure modes (8/9 digit confusion, sign-out vs
> break-time column swaps, bracket-shared time misreads, section over-
> propagation, stray fragments in `notes`). Touches `lib/openai.ts`,
> `app/scan/*`, `app/api/shifts/extract/route.ts`, `app/shifts/[id]/page.tsx`,
> and adds `lib/storage.ts`.

## OCR prompt changes (`lib/openai.ts`)

The vision prompt for `extractShiftsFromImage` now spells out every recurring
failure mode the model has shipped to production. Concrete additions:

- **Column → field map as a numbered table** (Col 1…11) with explicit
  `→ output field` arrows. The repeated failure was misalignment between
  Sign Out (Col 5) and Break Start (Col 7), which are two columns apart but
  visually adjacent on a phone photo.
- **Sanity check rule**: before emitting a row, verify
  `start < break_start < break_end < end`. If violated, re-read the row.
- **Sticky-section rule that knows when to stop**:
  - Section letter is sticky DOWN through blank Col-1 cells.
  - But: any visible mark in Col 1 — letter, circled letter, colored ink,
    scribble — terminates propagation. Do not inherit past such a mark.
  - Each horizontal "band" of the sheet (separated by repeated header rows)
    has its own independent section letters. Never propagate across bands.
  - Sections do not skip alphabetically: A→C with no B label means B has
    no shifts; C is C, not relabelled to B.
- **Colored-ink letters are authoritative**, not decorative. Don't skip a
  red/blue/circled letter just because it's stylized.
- **Notes-vs-time discipline**: `notes` is for free-text annotations only.
  Times never go in `notes`. If an annotation also drives a structured
  field (`meal_provided`, `break_minutes`), don't *also* dump it into
  `notes`. Fragments under 3 chars or single-token noise → null.
- **"Sign 3:30" pattern**: text like `Sign`, `Sign Out`, `S/O`, `SO`
  before a time means that time is `end_time`, never a break time, even
  when the writer ran out of room and put it in the break column area.
- **No-break hallucination guard**: when a row says "no break" anywhere
  across its break columns, do NOT extract any times from that row's
  break columns. Set `break_start_time=null`, `break_end_time=null`,
  `break_minutes=0`.
- **Digit discipline**: count loops to distinguish 8 (two stacked loops)
  from 9 (one loop with a stem). No bias toward later end-times — 8:30 PM
  and 9:30 PM are both common dinner-shift ends. If uncertain on a
  bracket-target digit, set confidence ≤ 0.6 on every row in the bracket
  so the manager spot-checks them.

## Server-side post-processing (`lib/openai.ts`)

After parsing, every row is run through:

- `hasConsistentTimes(s)` — clamps confidence to ≤ 0.4 if the time
  ordering is impossible (signature of a column mix-up). The shape of the
  data is the only thing the post-processor can reason about — if it's
  contradictory, it's wrong.
- `cleanNotes(s.notes)` — drops `notes` values that are fragments
  (< 3 chars, lone numbers like "1 n", time-shaped strings like "8:30",
  "10:"). Real annotations like "no break, no meal", "1 meal",
  "lipa lisa" survive.

## Review UI changes (`app/scan/ScanClient.tsx`)

### Time editing

`<input type="time">` was clipping values like `08:00` → `08:0C` at the
default width and was hard to override. Replaced with a custom `TimeInput`:

- **Single text input, 12-hour with AM/PM** display ("8:30 PM").
- Loose parser (`parseTime12`) accepts: "8:30 PM", "830pm", "8 am",
  "16:30", "8" — all canonicalize to internal `HH:MM` 24-hour on blur.
- Bare numbers default to PM (restaurant heuristic) since dinner shifts
  dominate.
- Press Enter or blur to commit; bad input reverts to the last good
  value. Internal storage stays 24-hour `HH:MM` so nothing downstream
  changed.

### "Must review" treatment

Confidence threshold for the per-row `needs_review` flag dropped from
`< 0.7` to `< 0.8`, AND every `inferred_from_bracket` row is auto-flagged
(brackets propagate misreads silently across 5+ rows, so they all need a
manager glance by default).

Visual treatment for flagged rows:

- Rose-pink row background + 4px red left border.
- Bold red **MUST REVIEW** pill at the start of the row.
- Per-cell red ring on the suspect time/section cells, *while* the value
  still equals the model's prediction — the moment the manager edits, the
  ring disappears (signal: "you've reviewed this").
- "model said: 9:30 PM" caption appears under any cell the manager
  changed, so they can compare their edit to the original prediction.
- Green **Confirm** button per row to dismiss the flag once verified.
- Red banner above the table counts the flagged rows and explains the
  contract.

### Predicted-value snapshot

Each `Candidate` now carries `predicted_section`, `predicted_start_time`,
`predicted_end_time` — the model's original guess, frozen at extraction
time. Used to drive the "model said:" caption above and the "is this cell
still suspect?" comparison for the red ring.

### Layout

- **Section grouping removed** — earlier iterations grouped review rows
  by section letter (A, B, C, …, Busboy). Reverted to flat OCR order so
  rows match the paper sheet's top-to-bottom listing exactly. The
  `section` field is still captured per row for filing.
- **Client-side image downscale removed** from both `ScanClient.tsx` and
  `ImportClient.tsx`. Earlier the upload was scaled to 2000px / JPEG 0.85,
  which was smudging handwritten "8" into "9" via JPEG compression.
  Original-resolution upload now goes straight to OpenAI; the server route
  caps inputs at 10MB and returns a clean error past that.

## Photo persistence (`lib/storage.ts`, extract route, approve action)

Schema already had `daily_sheets.scan_image_path`. Wired it up end to end:

1. **`lib/storage.ts`** (new) — `uploadScanImage()` and
   `getScanSignedUrl()` helpers using the Supabase admin client.
   Auto-creates the private `scans` bucket on first use; uploads under
   `scans/{YYYY-MM-DD}/{timestamp}-{safe-filename}`. Signed-URL TTL
   defaults to 1 hour.
2. **`app/api/shifts/extract/route.ts`** — after a successful OCR, the
   raw bytes are uploaded to the bucket. On upload failure the route logs
   and continues with `scan_image_path: null` rather than failing the
   whole request — the manager can still review the OCR result.
3. **`app/scan/ScanClient.tsx`** — captures the path from the API
   response, threads it through to `approveScannedSheet`.
4. **`app/scan/actions.ts`** — saves the path on the new `daily_sheets`
   row and on the matching `ocr_extractions` archive row. When reusing an
   existing daily sheet (e.g. re-scanning a corrected photo), only fills
   the path if the existing row didn't already have one.
5. **`app/shifts/[id]/page.tsx`** — server-side signed URL generation,
   rendered inside a collapsible `<details>` block titled "Original sheet
   photo". Free, lazy, doesn't push the rest of the page down by default.

## Manual setup required

The `scans` bucket auto-creates on first OCR upload via the service role
key, so no manual Supabase Studio click is needed in normal flow. If
something blocks bucket creation (e.g. project-level storage policy):

```sql
-- create the bucket manually in Supabase Studio or via the API
-- bucket name: scans, public: false, file size limit: 12 MB
```

No schema migration is needed — `daily_sheets.scan_image_path` was
already in `0001_init.sql`.
