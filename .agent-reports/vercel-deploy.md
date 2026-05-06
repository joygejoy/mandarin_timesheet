# Vercel deploy prep — agent report

> **Source**: parallel agent run, branch `worktree-agent-a572846e3e787e79c`,
> commit `9c2e702` (worktree-only, not pushed to main).
> Merged: README.md only (this report saved here for the record).

## Build status

- **Clean.** `npm run build` succeeds on Next.js 16.2.4 with Turbopack on the
  first try. No TypeScript errors, no lint blockers, no runtime errors at
  build time. No code changes were required to make the app deployable.
- **One harmless warning** — Vercel will show
  `Detected additional lockfiles` because this build was run inside a Claude
  worktree that has its own `package-lock.json` next to the parent's. It does
  not affect deploys originating from `main`. Leaving as-is.

## Env vars required

Inventoried by grepping `process.env.` across `app/`, `lib/`, and `scripts/`.
All four match `.env.local.example` exactly — no missing or undocumented
variables.

| Name                            | Used in                                            | Where to get it                                                              | Scope                                |
| ------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | `lib/supabase/server.ts`, `lib/supabase/client.ts` | Supabase → Project Settings → API → "Project URL"                            | Build + runtime (exposed to browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabase/server.ts`, `lib/supabase/client.ts` | Supabase → Project Settings → API → "anon public"                            | Build + runtime (exposed to browser) |
| `SUPABASE_SERVICE_ROLE_KEY`     | `lib/supabase/server.ts` (admin client)            | Supabase → Project Settings → API → "service_role secret" — **never commit** | Runtime (server-only)                |
| `OPENAI_API_KEY`                | `lib/openai.ts`, `scripts/test-openai.mjs`         | https://platform.openai.com/api-keys — **never commit**                      | Runtime (server-only)                |

## Vercel-specific changes

- **`README.md`** — replaced create-next-app boilerplate with a focused
  local-dev + Vercel-deploy guide, env var table, post-deploy checklist,
  Known Limitations.
- **No `vercel.json`.** Next.js on Vercel is zero-config; in-code
  `runtime`/`maxDuration` exports are honored by the build adapter.
- **No API route changes.** Routes already declare correct
  `runtime = 'nodejs'` and appropriate `maxDuration` values:

  | Route                          | runtime | maxDuration | Notes                                                          |
  | ------------------------------ | ------- | ----------- | -------------------------------------------------------------- |
  | `api/employees/extract`        | nodejs  | 60          | Fits Hobby tier (60s cap).                                     |
  | `api/shifts/extract`           | nodejs  | 90          | **Exceeds Hobby cap** — Hobby will cap at 60s; Pro honors 90s. |
  | `api/payroll/[id]/csv`         | nodejs  | (default)   | Fast.                                                          |

## Step-by-step deploy guide (also in README.md)

1. Push to GitHub (`git push -u origin main`).
2. Create a production Supabase project at https://supabase.com/dashboard.
3. Run `supabase/migrations/0001_init.sql` in Supabase SQL Editor.
4. Grab the three Supabase keys (Project URL, anon, service_role).
5. Get an OpenAI API key + add **$5 in credits** at
   https://platform.openai.com/settings/organization/billing.
6. Import the repo into Vercel at https://vercel.com/new.
7. Set env vars in the Vercel import screen:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`. Apply each to
   Production + Preview + Development.
8. Click Deploy (~2 minutes).
9. Smoke test: add an employee, upload a sheet photo, run a scan.
10. (Optional) Custom domain.
11. (Strongly recommended) Enable Vercel Deployment Protection — there's no
    in-app auth yet; anyone with the URL can edit data.

## Known issues / limitations

- **No auth, RLS bypassed.** Service role on every server call → anyone with
  the URL can read/write all data. Mitigate via Vercel Deployment Protection
  until per-user auth ships.
- **Vercel Hobby vs. Pro timeout cap.** `api/shifts/extract` declares
  `maxDuration = 90`. Hobby caps at 60s; Pro raises to 300s. Client-side
  image downscale (commit `f651a6d`) keeps most scans under 60s but isn't
  guaranteed. Recommendation: start on Hobby, upgrade if timeouts occur.
- **OpenAI cost.** ~$0.01 per `gpt-4o` vision call.
- **Single tenant.** No multi-restaurant scoping.
- **Pay-period overlap not enforced** in the schema.

## Verification

- `npm run build`: PASS — 15 routes compiled, ~5s.
- `npx tsc --noEmit`: PASS, zero errors.
- Route runtime / maxDuration audit: PASS, with the documented Hobby caveat.
