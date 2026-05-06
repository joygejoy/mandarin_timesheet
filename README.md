# Mandarin Timesheet

A web app that turns a restaurant manager's daily paper sign-in/out sheets into
biweekly payroll. The manager photographs a daily sheet, the app extracts shift
data with OCR (OpenAI `gpt-4o` vision), the manager corrects any unclear
fields, and approved days roll into the current biweekly pay period. Output:
a per-employee summary the manager can type into ADP, plus a leaderboard for
alcohol drink sales tallied by server.

See `PROGRESS.md` for the full feature checklist and roadmap.

## Stack

- **Next.js 16** (App Router, React 19, Turbopack)
- **Supabase** Postgres + Storage (RLS bypassed via service role key on the
  server until per-user auth lands)
- **OpenAI `gpt-4o`** for sheet OCR
- **Tailwind 4**, server actions, Zod
- **TypeScript** throughout
- Target deploy: **Vercel**

---

## Local development

You need:

- Node.js 20+ (Vercel runs Node 20; match it locally)
- A free Supabase project (https://supabase.com)
- An OpenAI API key with billing enabled (https://platform.openai.com)

### 1. Clone and install

```bash
git clone https://github.com/<your-account>/mandarin-timesheet.git
cd mandarin-timesheet
npm install
```

### 2. Create `.env.local`

```bash
cp .env.local.example .env.local
```

Fill in the four values:

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase dashboard → Project Settings → API → "Project URL"
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase dashboard → Project Settings → API → "anon public"
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase dashboard → Project Settings → API → "service_role secret" (keep this secret, never commit)
- `OPENAI_API_KEY` — https://platform.openai.com/api-keys

### 3. Run the database migration

In the Supabase dashboard, open the **SQL Editor**, paste the contents of
`supabase/migrations/0001_init.sql`, and run it. This creates the `employees`,
`pay_periods`, `daily_sheets`, `shifts`, `alcohol_sales`, and `ocr_extractions`
tables.

### 4. Start the dev server

```bash
npm run dev
```

Open http://localhost:3000.

---

## Deploy to Vercel

The user's flow, end-to-end. You only need a GitHub account, a Supabase
project, an OpenAI account with credits, and a Vercel account.

### 1. Push the repo to GitHub

If you haven't already, create a GitHub repo and push `main`:

```bash
git remote add origin https://github.com/<your-account>/mandarin-timesheet.git
git push -u origin main
```

### 2. Create a production Supabase project

This should be a separate project from your local dev one (don't share a
database between dev and prod).

1. Go to https://supabase.com/dashboard and click **New Project**.
2. Pick a name, region, and a strong database password. Save the password
   somewhere — you won't need it for deploy but you'll want it for direct DB
   access later.
3. Once provisioned (~2 minutes), open **SQL Editor**, paste
   `supabase/migrations/0001_init.sql`, and run it.
4. Open **Project Settings → API** and copy three values you'll paste into
   Vercel in step 4:
   - Project URL
   - `anon public` key
   - `service_role secret` key

### 3. Import the repo into Vercel

1. Go to https://vercel.com/new.
2. Click **Import Git Repository**, authorize GitHub, and pick the
   `mandarin-timesheet` repo.
3. Vercel auto-detects Next.js. Leave the framework preset, build command
   (`next build`), and output directory at their defaults.

### 4. Set environment variables

Before clicking Deploy, expand **Environment Variables** and add all four:

| Name                            | Value                                      |
| ------------------------------- | ------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | from Supabase API settings                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Supabase API settings                  |
| `SUPABASE_SERVICE_ROLE_KEY`     | from Supabase API settings (service_role)   |
| `OPENAI_API_KEY`                | from https://platform.openai.com/api-keys   |

Apply each one to **all three** environments (Production, Preview,
Development) unless you want different values per environment.

### 5. Deploy

Click **Deploy**. First build takes ~2 minutes. When it's green, click the
preview URL — you should land on the dashboard.

### 6. Set up Vercel CLI (optional, for local prod testing)

```bash
npm i -g vercel
vercel link        # links your local repo to the Vercel project
vercel env pull    # pulls prod env vars into .env.local
```

---

## Post-deploy checklist

Run through this once after the first successful deploy:

- [ ] **Visit `/employees`** — page loads, shows empty list. (If you see a
      "Supabase not configured" error, double-check your env vars in Vercel and
      redeploy.)
- [ ] **Add a test employee** — confirms the service role key is wired and DB
      writes work.
- [ ] **Visit `/employees/import`** and upload a sheet photo — confirms the
      OpenAI key works and the OCR route can finish within Vercel's timeout.
- [ ] **Visit `/scan`** and run a daily-sheet OCR — same as above but for the
      bigger shift-extraction route (`maxDuration = 90s`, see Known
      limitations).
- [ ] **Confirm OpenAI billing** — make sure you have at least **\$5 in
      credits** at https://platform.openai.com/settings/organization/billing.
      A free tier with no credits returns `insufficient_quota` errors.
- [ ] **Set a custom domain** (optional) — Vercel project → Settings → Domains.

### Optional features (not yet built)

The deploy works without these, but they appear on the roadmap:

- **Google Sheets integration** — not implemented yet. No env vars needed.
- **PDF export** — not implemented yet. (PDF *import* for employee rosters
  works out of the box via `pdfjs-dist`.)

---

## Required environment variables

| Name                            | Where to get it                                                                | Scope        |
| ------------------------------- | ------------------------------------------------------------------------------ | ------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase → Project Settings → API → "Project URL"                              | Build + runtime (exposed to browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → "anon public"                              | Build + runtime (exposed to browser) |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase → Project Settings → API → "service_role secret" — **never commit**   | Runtime (server-only) |
| `OPENAI_API_KEY`                | https://platform.openai.com/api-keys — **never commit**                        | Runtime (server-only) |

`NEXT_PUBLIC_*` values are inlined into the client bundle at build time, so
the browser sees them. Treat the anon key as public (it's designed for that).
The service role key and OpenAI key are server-only and used inside server
actions and API routes; they must never be exposed to the browser.

---

## Project structure

```
app/                    Next.js 16 App Router pages & route handlers
  api/employees/extract  OCR route — reads sheet image/PDF/CSV, returns names
  api/shifts/extract     OCR route — reads daily sheet image, returns shifts
  api/payroll/[id]/csv   CSV export of biweekly summary
  employees/             Employees CRUD, import, inline rate edit
  shifts/                Daily shift entry + approve workflow
  payroll/               Pay periods list + biweekly rollup
  scan/                  Daily sheet OCR review screen
  alcohol/               Alcohol sales entry + leaderboard
lib/
  payroll.ts             Pure payroll math (hours, daily, biweekly)
  openai.ts              GPT-4o vision helpers (employees + shifts)
  supabase/{server,client}.ts
  parsers/{pdf,excel}.ts Roster import parsers
supabase/migrations/    DB schema (one-shot init)
```

---

## Known limitations

- **No auth, RLS bypassed.** Every server-side DB call uses the Supabase
  service role key, so anyone who can reach your deployment can read and write
  every table. **Restrict access at the Vercel level** (use
  https://vercel.com/docs/security/deployment-protection or a custom domain
  behind a password) until per-user auth lands. This app is built for one
  manager today.
- **Vercel function timeouts.**
  - The shift OCR route (`/api/shifts/extract`) declares `maxDuration = 90`.
    Vercel's free **Hobby** tier caps function execution at **60 seconds** —
    long scans will time out. The **Pro** tier (\$20/month) raises this to
    300s. If you stay on Hobby, very large or busy daily sheets may fail; the
    image is downscaled client-side to mitigate this.
  - The employee OCR route (`/api/employees/extract`) declares
    `maxDuration = 60`, which fits within Hobby.
- **OpenAI cost.** Each daily-sheet scan costs roughly \$0.01 in `gpt-4o`
  vision calls. Daily scans for a year ≈ \$3.65/year. Bulk-importing a 50-row
  roster from a photo is one call (~\$0.01).
- **Single-manager use.** Pay periods, employees, and sheets are not scoped to
  any user — there's only one global dataset. Don't deploy a single instance
  for multiple restaurants.
- **Images only for shift OCR.** `/api/shifts/extract` accepts JPG/PNG/HEIC
  (max 10 MB). Roster import (`/api/employees/extract`) also accepts CSV,
  TSV, TXT, PDF, and XLS/XLSX.
- **Pay period overlap is not enforced** in the schema. Don't create
  overlapping periods.
- **Lockfile warning.** If you build inside a worktree you may see a
  `Detected additional lockfiles` warning — harmless, ignore.

---

## Available scripts

| Script          | What it does                              |
| --------------- | ----------------------------------------- |
| `npm run dev`   | Start the dev server (Turbopack) on :3000 |
| `npm run build` | Production build                          |
| `npm start`     | Start the production server (after build) |
| `npm run lint`  | Run ESLint                                |
