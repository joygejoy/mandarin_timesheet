# Progress notes — department RBAC + hostess/bar weekly scan

Branch: `department-control`. Nothing committed yet — everything below is in the working tree.

## Done and working

### Department RBAC (Jeff = servers_bus, Fred = hostess_bar, admin = all)
- Migrations `0002`–`0004` (`0002` pre-existing; `0003` renames departments to `servers_bus`/`hostess_bar`, moves Bartender out of servers_bus into hostess_bar, renames `users.default_department` → `users.department`; `0004` adds `shifts.work_date`).
- `lib/permissions.ts`, `lib/department-view.ts`, `lib/roles.ts`, `lib/session-edge.ts`: department is signed into the session JWT at login and enforced server-side in every write path (`app/shifts/actions.ts`, `app/scan/actions.ts`, `app/employees/actions.ts`). Reads (Dashboard/Shifts/Payroll) are open to everyone via a `?view=` URL param that resets to the viewer's own department on every fresh page load — **bug found and fixed**: the toggle wasn't calling `router.refresh()`, so switching departments showed stale data. Also found and fixed: two stale legacy accounts (`jeffmandarin`/`fredmandarin`) had their departments swapped — deactivated in favor of `jeff`/`fred`/`admin`.
- Scan page is hard-locked to the user's own department for non-admins (no picker). Alcohol Sales writes are `servers_bus`-only regardless of whose sheet the points are on.
- Employees roster stays globally readable; writes are department-scoped. Bulk xlsx import (`lib/parsers/excel.ts`) fixed to detect an unlabeled employee-number column positionally — verified against the real `front staff names.xlsx` (27/27 rows now get their emp #). Added a bulk "set every row's role" button in `app/employees/import/ImportClient.tsx` so Fred can set everyone to Hostess in one click, then hand-correct Norman to Bartender.

### Hostess/bar weekly sheets (structural piece — this part is solid)
- One `daily_sheets` row = one **week** for hostess_bar (keyed on the week's Monday), same lifecycle (draft/reviewing/approved) as a servers_bus day. `shifts.work_date` lets each shift row remember its actual day within that week.
- `lib/payroll.ts`'s `calendarDatesForSheet()` expands a hostess_bar sheet into its 7 calendar dates so Dashboard/Shifts/Payroll calendars show 7 day-cells all linking to the same sheet (per user's explicit request). `by_date` bucketing in `summarizePayPeriod` keys on `shift.work_date ?? day.sheet_date` so CSV/PDF day-of-week columns are correct.
- `app/shifts/[id]/ShiftRows.tsx` groups shifts by `work_date` with day-headers; `ChangeDateButton.tsx` shows "Week of X–Y" instead of a single date for hostess_bar sheets. Nav label reads "Shifts" instead of "Daily Shifts" when viewing hostess_bar.
- `supabase/migrations/0005_shift_override_totals.sql`: `shifts.net_minutes_override` / `shifts.meal_deduction_override` — lets a shift row carry a bookkeeper-provided weekly total directly instead of being computed from start/end times. `lib/payroll.ts`'s `shiftPaidMinutes`/`shiftMealDeduction` honor these when set (servers_bus rows are unaffected — those fields stay null). This part is right: the paper sheet already has NET HOUR / MEAL DED totals computed by hand: no reason to make the model reconstruct them from 7 days of tiny fractional handwritten times.
- `app/scan/actions.ts`'s `approveScannedGrid` saves one shift row per employee per week with these overrides. `ShiftRows.tsx` renders an editable "Net hours (week)" / "Meal ded. $" pair for override rows instead of Start/End/Break/Meal.

## NOT working — OCR name↔numbers pairing is unreliable

**The problem:** asking GPT-4o to read NET HOUR and MEAL DED off the scanned weekly grid photo and attach them to the correct employee name reliably scrambles the pairing — one employee's real, correctly-read number ends up attached to a *different* employee's name. Confirmed with hand-transcribed ground truth against two real sample photos (`C:\Users\missj\Downloads\hostess-norman\2383.jpeg` and `2384.jpeg`).

**Five extraction strategies were tried, in order, each verified live against real photos with three parallel investigation agents cross-checking against manual transcriptions — all failed:**

1. **Single call**, one row = `{employee_number, employee_name, net_hours, meal_deduction}` together. ~5-10% of rows correct. Root cause found: the model reads both halves of a row fine but binds them to the wrong row once it has to trace all the way across a long, dense grid.
2. **Two-pass zip**: one call reads names top-to-bottom, a separate call reads just the two numbers top-to-bottom (no identity), zipped by list position in code. Still ~0% correct — the two passes don't agree on which blank rows "count," so they desync immediately.
3. **Named-batch lookup**: small batches (3-6 named employees) per call, asking the model to *find that specific person's row* rather than blindly counting. This was the approach that worked well earlier for a *different* (day-by-day time) extraction task, but for this totals task it only got ~10-15% correct.
4. **Image-band cropping**: crop the photo into horizontal bands (~3-9 rows per band) with `sharp`, extract each band independently, merge+dedupe by name. This was the most promising direction — accuracy trended up as bands got smaller (5-band: ~43% correct, single-call baseline: ~5%).
5. **Near-single-row crops** (2-row bands, 3x upscaled for legibility): expected this to approach ~100% given the trend, but it plateaued at **~48% correct** and revealed the real failure mode — a *highly consistent, reproducible 2-row shift* (e.g. Sueva's row consistently returns Hilary's exact real number, Andrea's returns Simranjeet's, across repeated runs). This isn't noise a better prompt fixes — something about this document's layout (possibly the multi-line column headers, or row-height inconsistency) causes GPT-4o to systematically misalign name-column reading with totals-column reading even at small crop sizes.

**What IS reliable, confirmed across every attempt:** reading employee names/identities in the sheet's own top-to-bottom order (93-100% correct every time). The failure is specifically in binding the two numeric totals to the right name — not in finding names, not in reading the numbers in isolation.

## Decision (made by user, 2026-07-12): pause here, revisit later

Chosen direction once work resumes: **auto-fill the employee list only** (reliable, ~27 rows in correct sheet order), leave NET HOUR / MEAL DED blank/0 for manual entry — Fred types those two numbers per employee while looking at the photo, which the review screen already shows side-by-side. Slower than full automation, but never silently wrong, which matters a lot more for payroll data than typing speed.

**This fallback has NOT been implemented yet.** The current code in `lib/openai.ts` (`extractHostessGridFromImage`) still contains attempt #3 (named-batch lookup) from the investigation — it still tries to auto-fill hours/meal and will produce wrong numbers if scanned today. Whoever picks this up next should either:
- (a) implement the chosen fallback (strip the totals-reading calls entirely, keep only a reliable name+order extraction, default `net_hours`/`meal_deduction` to 0, add clear UI copy telling Fred to fill them in from the photo), or
- (b) attempt further engineering (true single-row crops with proper row-boundary detection instead of assumed-equal-height bands, or a different OCR approach/service entirely) if there's appetite to keep investigating — no guarantee of success, evidenced by 5 failed attempts already.

## Migrations still to run (none have been applied to Supabase yet, per earlier conversation)
`0003_department_rbac_rename.sql`, `0004_shift_work_date.sql`, `0005_shift_override_totals.sql` — run in that order in the Supabase SQL editor.

## Verification status
`npx tsc --noEmit` re-confirmed clean at the end of this session (after scratch-file cleanup). `pnpm build` was clean earlier in the session — worth a quick re-run when picking this back up, just as routine hygiene. Test suite (`pnpm test`) passing throughout, unaffected by any of this (no existing tests cover the new grid/OCR code).
