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

### Done this session (2026-05-09)

Roster & wages
- [x] **xlsx import handles multi-section sheets** — parser detects the name
      column from the header row, skips header rows mid-file, `TOTAL`/`Sum`
      rows, and rows where the chosen name cell is empty/numeric. Verified on
      a 47-row "server and busboy.xlsx" (servers + busboys + Wayne).
- [x] **Robust dedupe across re-imports** — new `lib/normalize.ts` collapses
      case, punctuation, whitespace, and diacritics. `Lisa F` / `lisa  f.` /
      `LISA-F` / `Lísa F` all merge. Dedupe now includes inactive employees
      so deactivate-then-re-import never spawns a second row.
- [x] **Ontario wage presets** in `lib/wages.ts` (Min $17.60, Student $16.60,
      Custom). New `WageSelect` component used in `EmployeeForm` and the
      bulk-import preview; default rate everywhere bumped from $17.50 →
      $17.60.
- [x] **Inline wage dropdown on employee row** (`InlineWageEditor`) — pick
      Min/Student to auto-save, Custom reveals an inline number input. Toggles
      in one click without navigating to the detail page.
- [x] **Bulk delete + reset** — `Select` mode with checkboxes, `Delete N`,
      `Delete all`, and `Reset wages → min` all wired to new server actions
      (`deleteEmployees`, `deleteAllEmployees`, `setAllWagesToMinimum`).

Employees page UX
- [x] **Apple-Contacts-then-pages refactor** — list is now a flat
      alphabetical `EmployeesClient` with **10 employees per page**, Prev/Next
      buttons, page-jump select, A–Z jump rail (clicking a letter sets the
      page containing that letter). Search by name OR role resets to page 1.
      Avatar circle dropped per request; row shows index, name, role/break/
      meal subline, wage editor, hover Deactivate/Delete.

Daily-sheet OCR (scan review)
- [x] **Per-cell highlighting** — `CellShell` wraps each cell with an amber
      tint when OCR is uncertain or rose when a required field is empty;
      `ReviewHint` shows `⚠ check time (model: 4:30 PM)` inline. Confidence
      threshold unified at <0.8 so flagged rows always have visible cells.
- [x] **Confirm button** — promoted from a quiet pill to a filled blue
      "✓ Confirm" button, paired with a one-line `verify: start, end` summary
      so the user knows which columns to look at before clicking.
- [x] **Section column dropped** from scan review — manager couldn't edit it
      meaningfully and it cluttered the table. Section is still extracted by
      the model and saved to the DB; per-shift editor on the daily sheet
      detail keeps it editable.
- [x] **Notes column collapses** to a small `📝` icon button (blue when the
      row already has notes); click expands an inline input that auto-focuses
      and collapses on blur/Enter/Escape.
- [x] **Sheet-order preservation** — added `display_order int` column
      (`migration 0002_shift_display_order.sql`), populated on save with the
      OCR row index. Daily-sheet detail sorts by `display_order` →
      `start_time` → `created_at` in JS so it works whether or not the
      migration has been applied. Save action retries without the column on
      schema-cache errors.
- [x] **OCR prompt: top-to-bottom rule** — explicit "DO NOT alphabetize, DO
      NOT group by section, DO NOT sort by start_time" instruction at the top
      of the system prompt.
- [x] **Auto-correct AM/PM confusion** — server-side `fixObviousAmPmConfusion`
      flips obvious 4:30 → 16:30 cases using `shift_type` (lunch vs dinner)
      windows, then lowers confidence so the manager spot-checks.

Payroll
- [x] **$2 meal deduction** — `MEAL_DEDUCTION = 2`, helpers `shiftGrossPay`,
      `shiftMealDeduction`, `shiftPay` (now returns NET). Daily/biweekly
      summaries expose `gross_pay`, `meal_deduction`, `net_pay`,
      `meal_count`. Per-shift "Pay" cell shows `−$2.00 meal` underneath the
      dollar amount when the meal box is checked; payroll detail table gains
      `Meal $` and `Net pay` columns; CSV/PDF/Sheets exports all updated.
- [x] **Lazy-load original sheet photo** — new `/api/sheets/[id]/scan-url`
      route + `ScanPhotoPanel` client component fetches the signed URL only
      when the dropdown is opened. Daily-sheet page no longer pays the
      signing roundtrip on every load.

Daily shifts page
- [x] **Clearer "Open the day"** — primary `→ Open today` button (single
      click, today pre-filled in a hidden field), secondary date picker for
      any other date, helper copy explaining "opens existing or creates new".
- [x] **Filter & sort toolbar** — date filter (substring match — typing
      `2026-05` matches a whole month), sort toggle (Newest first / Oldest
      first), `Clear` link when filtered, `Showing N of M` count.
- [x] **`Open →` row buttons** instead of the small text link.

Notion-style UI refresh
- [x] **Tokens in `globals.css`** — off-white `--background`, hairline
      `--border`, accent blue, plus utilities `surface`, `dot`, `link-soft`,
      and quieter `btn-primary`/`btn-secondary`/`btn-ghost`.
- [x] **Flat sidebar** with usePathname-based active state; quiet status dots
      replacing colored pills across `/employees`, `/shifts`, `/payroll`.
- [x] Refactored `/`, `/employees`, `/employees/import`, `/scan`, `/shifts`,
      `/shifts/[id]`, `/payroll`, `/payroll/[id]`, `/alcohol`, employee form
      to the same chrome-light surface/dot pattern.

Other
- [x] Reinstalled `pdfkit` (was missing from `package.json`, breaking the
      payroll PDF download with `Module not found: pdfkit/js/pdfkit.standalone`).
      Standalone bundle confirmed at
      `node_modules/pdfkit/js/pdfkit.standalone.js`.

### Not yet built

- [ ] **Auth + RLS policies** so multiple managers can share the app safely.
- [ ] **Push to Vercel** (deploy prep is done; user actually triggers the deploy).
- [ ] **Alcohol points in the scan flow** — discussed: per-row columns would
      be confusing for multi-shift servers; better path is a separate
      "Alcohol points" panel below the shifts table on the scan review
      screen, deduped per server. Awaiting user go-ahead.

## Migrations to apply

If you haven't yet, run this in your Supabase SQL editor:

- `supabase/migrations/0002_shift_display_order.sql` — adds the
  `display_order` column the OCR scan uses to preserve sheet row order.
  The app falls back gracefully without it (sorting by start_time), so this
  is optional but recommended.

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
