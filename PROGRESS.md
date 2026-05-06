# Mandarin Timesheet

## What this is

A web app that turns a restaurant manager's daily paper sign-in/out sheet into
biweekly payroll. The manager scans (or photographs) a daily sheet, the app
extracts shift data with OCR, the manager corrects any unclear fields, and the
day rolls into the current biweekly pay period. Output: a tidy summary the
manager can type into ADP, plus a leaderboard for alcohol drink sales tallied
by server.

**Inputs**
- Daily sign-in/sign-out sheet (photo)
- Employee roster with hourly rates, role, age, default break/meal rule
- Pay period dates (biweekly)
- Alcoholic drinks sold per server per day
- Optional manual adjustments

**Outputs**
- Daily summary (hours, pay, exceptions per employee)
- Biweekly payroll summary (per-employee totals across the period)
- Alcohol sales leaderboard (top sellers for the period)
- Excel / CSV / PDF export
- (Eventually) Google Sheets integration

## Stack

- **Next.js 16** (App Router, React 19, Turbopack)
- **Supabase** Postgres + Storage (RLS bypassed via service role on the
  server until per-user auth lands)
- **OpenAI `gpt-4o` vision** for sheet OCR and employee extraction
- **Tailwind 4** for styling, server actions for mutations, Zod for input
  validation
- **TypeScript** throughout
- Target deploy: **Vercel**

## Progress

### Built and shipped to `main`

| Commit    | Feature                                                                                |
|-----------|-----------------------------------------------------------------------------------------|
| `8d6bbd8` | Initial Next.js scaffold pushed to GitHub                                              |
| `b7aa3e3` | Phase 1: DB schema, dashboard shell, employees CRUD, Supabase wiring                   |
| `d2d1d86` | Switch server-side DB calls to service role key (bypass RLS for MVP)                   |
| `873244e` | Mass employee import from sheet (GPT-4o vision) + delete + payroll calc lib + pay periods |
| `9c3d168` | Inline hourly rate editing in employees list                                           |
| `53233c8` | Daily shift entry: list, per-day editor, inline edits, approve workflow                |
| `87c9553` | Biweekly rollup at /payroll/[id] + CSV export                                          |
| `cd7f969` | Alcohol sales: per-day entry + biweekly leaderboard                                    |
| `06fc31c` | Full daily-sheet OCR with side-by-side review                                          |
| `91da454` | Surface friendly OpenAI errors (quota, auth, rate limit)                               |
| `f651a6d` | Downscale scan images client-side before upload                                        |
| `0a1204c` | Employee import accepts CSV / TSV / TXT in addition to images                          |
| `dc78dbe` | PDF and Excel support for employee import                                              |
| `747b97b` | Roster-aware OCR + filterable employee combobox                                        |
| `f86a056` | Filter non-names from employee OCR (prompt + safety net)                               |
| `7a4508f` | Vercel deploy prep: README + deploy guide (parallel agent)                             |

### Feature checklist

- [x] **Employees**: list, add, edit, delete, deactivate, inline rate editing
- [x] **Mass import employees from a sheet photo** (GPT-4o vision → editable
      candidate list → bulk save with duplicate detection)
- [x] **Pay periods**: list, create biweekly periods (auto-suggests next dates)
- [x] **Daily shifts**: per-date sheet, add shifts (snapshots employee rate),
      inline edit (section, start, end, break, meal, rate, notes), delete,
      approve workflow, daily summary cards
- [x] **Payroll calculation library** (`lib/payroll.ts`): pure functions for
      shift hours, daily summary, biweekly rollup, date helpers
- [x] **DB schema** (`supabase/migrations/0001_init.sql`): employees,
      pay_periods, daily_sheets, shifts, alcohol_sales, ocr_extractions
      with snapshot fields so historical pay survives employee edits

### Done since the last PROGRESS update

- [x] **Biweekly rollup view** at `/payroll/[id]` with calendar strip and
      per-employee summary
- [x] **CSV export** of biweekly summary
- [x] **Alcohol sales** entry per day + biweekly leaderboard with podium
- [x] **Full daily-sheet OCR** with side-by-side review (photo on left,
      editable rows on right, low-confidence flags, bracket-inferred
      end-times surfaced)
- [x] **Roster-aware OCR** — active employees passed into the prompt so
      the model picks canonical spellings (handles "Lisa" / "LisaFn" / etc.)
- [x] **Filterable employee combobox** replacing every plain `<select>`
- [x] **Employee import accepts CSV / TSV / TXT / PDF / XLS / XLSX** in
      addition to image OCR; non-image formats parsed directly with no
      OpenAI cost
- [x] **Friendly OpenAI errors** for quota/auth/rate-limit cases
- [x] **Client-side image downscale** before scan upload (avoids socket
      drops on multi-MB phone photos)
- [x] **Non-name filter** for employee OCR (drops times, initials,
      "NO BREAK", section labels, etc.)
- [x] **Vercel deploy prep** — README, env audit, deploy guide
      *(parallel-agent delivery — see `.agent-reports/vercel-deploy.md`)*
- [x] **Google Sheets integration** — POST `/api/payroll/[id]/sheets`
      pushes biweekly summary to a service-account-shared spreadsheet
      *(parallel-agent delivery — see `.agent-reports/google-sheets.md`;
      UI button still pending — see "What the manager needs to do")*

### Not yet built

- [ ] **Auth + RLS policies** so multiple managers can share the app safely
- [ ] **Push to Vercel** (deploy prep is done; user actually triggers the deploy)

PDF export, Google Sheets push, and the UI buttons that wire all three
download paths into `/payroll/[id]` are now done — see
`.agent-reports/pdf-export.md` and `.agent-reports/google-sheets.md`.

## Next time — open issues to tackle

These came up during testing on real sheets and are not yet fixed:

1. **Employee OCR still picks up some non-names.** Specifically "Dining
   Room" was extracted as if it were a name. The current blocklist in
   `lib/openai.ts > NON_NAME_BLOCKLIST` doesn't include room/area
   labels. Add: "dining room", "kitchen", "bar", "patio", "host stand",
   plus a more general rule: drop any candidate whose tokens are all
   common-noun room/area words.
2. **Shift OCR misses or mangles some times.** On real scans, some
   start/end times come out wrong or null even when the photo is
   readable. Likely contributors:
   - The model sometimes confuses "4:30" with "16:30" inconsistently —
     the prompt says "restaurant context, write 4:30 as 16:30" but the
     model occasionally outputs `04:30`. Tighten the prompt with
     explicit examples per shift type (lunch sheet morning vs. dinner
     evening).
   - When a cell has bracket notation, the model occasionally drops
     the time on the FIRST row of the bracket while filling later
     rows. Add an explicit instruction: "the row where the bracket
     STARTS gets the same time as the rows below it".
   - Photo quality: very low contrast or skewed shots produce missing
     fields. The client-side downscale to 2000px may be losing detail
     on dense sheets — consider raising to 2500px.
3. **Auth + RLS** still not done. Vercel Deployment Protection is the
   stopgap (documented in README and the Vercel report).

## Next steps (recommended order)

1. **Biweekly rollup + CSV export** — finish the payroll loop. The calc
   library and approve-the-day workflow are already in place; what's missing
   is the page that pulls all approved sheets in a period and shows the
   per-employee table you'd type into ADP. Smallest piece, highest immediate
   value.
2. **Alcohol sales entry + leaderboard** — small, self-contained feature.
   Per-day point tally per server, leaderboard for the current period.
3. **Full daily-sheet OCR review** — the big one. Reuse the
   `extractEmployeesFromImage` pattern but extract shifts (employee, section,
   start, end, break, meal, notes, initials) with confidence flags. Build a
   side-by-side review screen (original photo on the left, editable rows on
   the right, low-confidence cells highlighted). Approve straight into a
   daily sheet.
4. **Google Sheets integration** — read/write to a manager-owned sheet for
   biweekly payroll.
5. **Auth + RLS** — Supabase auth with email magic-links, then row-level
   policies on every table keyed off `auth.uid()`.
6. **Deploy to Vercel** with proper env-var wiring and a production
   Supabase project.

## How to run

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase URL + keys, OpenAI key
npm run dev
```

Then open the SQL editor for your Supabase project and run
`supabase/migrations/0001_init.sql` once.

## Open questions for the user

- **OCR cost** — at ~$0.01 per sheet, daily scans for a year is ~$3.65.
  Acceptable? Or should we cache aggressively / batch?
- **Rate snapshots vs. live rates** — currently each shift snapshots the
  employee's hourly rate at the moment the shift is added, so changing an
  employee's rate later does NOT retroactively change historical pay. This
  matches typical payroll behavior; confirm that's the intended rule.
- **Pay period overlap** — schema currently allows overlapping pay periods.
  Should we enforce non-overlap, or leave that to the manager?
- **Alcohol sales** — top 3 leaderboard for the period was in the spec, but
  do we also want per-server history graphs, weekly delta, etc?
