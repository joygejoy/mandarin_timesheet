# Google Sheets — agent report

> **Source**: parallel agent run, branch `worktree-agent-af4158cb2e06ab9da`,
> commit `2f27985` (worktree-only). Cherry-picked into main:
> `app/api/payroll/[id]/sheets/route.ts`, `lib/google-sheets.ts`,
> `.env.local.example`, `package.json`, `package-lock.json`.

## What was added

- `googleapis` dependency (npm install).
- `lib/google-sheets.ts` — service-account JWT auth + `pushBiweeklySummary()`
  that creates a uniquely-named tab in the configured spreadsheet, writes
  title/header/per-employee rows + totals row, bolds and freezes the header.
  Exports `isGoogleSheetsConfigured()` and `GoogleSheetsNotConfiguredError`.
- `app/api/payroll/[id]/sheets/route.ts` — POST route that mirrors the CSV
  route's data fetch (approved sheets only), rolls up via
  `summarizePayPeriod`, pushes to Sheets. Returns
  `{ ok: true, tabName, url }` on success or `{ error }` with helpful
  status (`503` missing env, `404` unknown period, `500` other failures).
- `.env.local.example` — added `GOOGLE_SHEETS_CREDENTIALS_JSON` and
  `GOOGLE_SHEETS_SPREADSHEET_ID` with inline setup steps.

## Setup instructions for the user (~5 min)

1. **Create a Google Cloud project** at https://console.cloud.google.com/
   (or pick existing). Top bar → New Project → name it whatever.
2. **Enable the Sheets API** at
   https://console.cloud.google.com/apis/library/sheets.googleapis.com
   → Enable.
3. **Create a service account.** APIs & Services → Credentials →
   + Create credentials → Service account. Skip the optional grant
   steps. Click Done.
4. **Download the JSON key.** Click the new service account → Keys tab
   → Add key → Create new key → JSON → Create. Open the downloaded JSON
   file in a text editor and copy the entire contents.
5. **Share the target spreadsheet with the service account.** Open the
   Google Sheet you want payroll pushed into. Find `client_email` in the
   JSON (looks like `name@project-abc.iam.gserviceaccount.com`). Click
   Share in the sheet → paste that email → Editor → uncheck "Notify" →
   Share.
6. **Copy the spreadsheet ID** from the URL:
   `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit#gid=0`.
7. **Add env vars to `.env.local`:**
   - `GOOGLE_SHEETS_SPREADSHEET_ID=<the id>`
   - `GOOGLE_SHEETS_CREDENTIALS_JSON=<the entire JSON, single line>`
   The literal `\n` inside `private_key` is fine — the app converts them.
   Wrap in single quotes if the shell complains.
8. **Restart the dev server.**
9. **Test:** approve at least one daily sheet in a pay period, then
   `curl -s -X POST http://localhost:3000/api/payroll/<period-id>/sheets`.
   Expect `{"ok":true,"tabName":"Payroll <start> to <end>","url":"..."}`.

## Common errors

- `Google Sheets is not configured…` — env vars missing or empty; check
  spelling and that you restarted the dev server.
- `The caller does not have permission` — you forgot step 5 (share the
  sheet with the service account email).
- `Requested entity was not found` — wrong spreadsheet ID.
- `error:0909006C:PEM routines:get_name:no start line` — the
  `private_key` lost its newlines. Re-paste from the original JSON.

## API endpoint

- **POST** `/api/payroll/[id]/sheets`
- **Auth**: server-side; no user OAuth (service account does the writing).
- **Success**: 200 with `{ ok, tabName, url }`. Tab name auto-suffixes
  ` (2)`, ` (3)` if a tab already exists, so existing data is never
  overwritten.
- **Errors**: 503 missing/invalid creds, 404 unknown period, 500 other
  Sheets API errors (with hint to re-share for permission errors).

## What the manager needs to do (UI button)

Add a "Push to Google Sheets" button to `app/payroll/[id]/page.tsx`
next to the existing CSV download. Suggested client component:

```tsx
'use client'
import { useState } from 'react'

export function PushToSheetsButton({ periodId }: { periodId: string }) {
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'pending' }
    | { kind: 'ok'; url: string; tabName: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  async function push() {
    setStatus({ kind: 'pending' })
    try {
      const res = await fetch(`/api/payroll/${periodId}/sheets`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setStatus({ kind: 'ok', url: json.url, tabName: json.tabName })
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button onClick={push} disabled={status.kind === 'pending'} className="btn-secondary">
        {status.kind === 'pending' ? 'Pushing…' : 'Push to Google Sheets'}
      </button>
      {status.kind === 'ok' && (
        <a className="text-sm underline" href={status.url} target="_blank" rel="noreferrer">
          Open “{status.tabName}”
        </a>
      )}
      {status.kind === 'error' && <span className="text-sm text-rose-600">{status.message}</span>}
    </div>
  )
}
```

## Verification

- typecheck: pass (after `next dev` populated `.next/types/...`, normal for
  Next 16 and same as the existing CSV route).
- dev server boots, compiles the new route on demand.
- Error path with no creds: `503` with the friendly message.
- Lint: pass on new files.
- Happy path with live credentials: **not exercised in worktree** (no
  real service-account JSON). API surface (`spreadsheets.get`,
  `spreadsheets.batchUpdate`, `spreadsheets.values.update`) is the
  standard googleapis pattern.

## Future scope (not in this commit)

- Per-period or per-user spreadsheet ID (currently one global).
- OAuth flow for users who'd rather grant access via their own Google
  account than create a service account. The current MVP path is faster
  to set up.
