# PDF export — agent report

> **Source**: parallel agent run, branch `worktree-agent-af3feb089ef7a33ff`,
> commits `ccaaa79`, `62b029d`, `f6ac35a` (worktree-only). Cherry-picked
> into main: `app/api/payroll/[id]/pdf/route.ts` and `lib/pdf-render.ts`.
> `pdfkit` + `@types/pdfkit` re-installed on top of current main deps.

## What was added

- `app/api/payroll/[id]/pdf/route.ts` — GET handler that mirrors the CSV
  route (approved sheets only, ordered by date), runs `summarizePayPeriod`,
  and streams a Letter-size PDF with proper
  `Content-Disposition: attachment; filename="payroll_<start>_<end>.pdf"`.
- `lib/pdf-render.ts` — rendering helper. Header (title / period / status /
  generated-at), per-employee table with zebra rows (Employee, Rate, Shifts,
  Hours, Gross pay, Alcohol pts), styled TOTAL footer, page-break-aware
  repeat header, "Page N of M" footers stamped via `bufferedPageRange()`.

## Library

**pdfkit** ^0.18.0, imported via the `pdfkit/js/pdfkit.standalone` entry
(not the regular root entry). Reasons:

- No React peer-dep — survives this stack's React 19 + Next 16 + Turbopack
  shape. `@react-pdf/renderer` lists React 18 as a peer, which can drift.
- Streaming imperative API → exact-pixel column layout, page breaks, and
  post-render page numbering with `bufferPages: true` / `switchToPage()`.
- ~1.5 MB runtime bundle after tree-shaking. Smaller than puppeteer/
  chromium by orders of magnitude. Comparable to `@react-pdf/renderer`.

**Important Turbopack gotcha**: pdfkit's regular entry reads its built-in
PDF Standard 14 font metrics off disk via `__dirname`-relative paths
(`fs.readFileSync(__dirname + '/data/Helvetica.afm')`). Turbopack inlines
pdfkit and rewrites `__dirname`, so that fails with `ENOENT: Helvetica.afm`.
The package ships `pdfkit/js/pdfkit.standalone` — a precompiled browserify
bundle where `brfs` has inlined the AFM data as base64. No runtime FS
lookups, works under Turbopack, webpack, and Vercel. Use the standalone
entry; do NOT change to plain `pdfkit`.

## Verification (after merge)

- `npx tsc --noEmit`: pass on main.
- `curl -s -D - -o test.pdf http://localhost:3000/api/payroll/<id>/pdf`:
  ```
  HTTP/1.1 200 OK
  cache-control: no-store
  content-disposition: attachment; filename="payroll_2026-05-04_2026-05-17.pdf"
  content-type: application/pdf
  ```
  `file test.pdf` → `PDF document, version 1.3, 2 page(s)`.

## Manager-side change applied

A "Download PDF" anchor was added next to "Download CSV" on
`app/payroll/[id]/page.tsx`:

```tsx
<a
  href={`/api/payroll/${id}/pdf`}
  className="btn-secondary"
  download={`payroll_${period.start_date}_${period.end_date}.pdf`}
>
  Download PDF
</a>
```

Plain anchor click works because the route returns
`Content-Disposition: attachment`. No JavaScript needed.

## Known caveats

- **Lockfile warning** on `next dev` because the worktree had its own
  `package-lock.json`. Cosmetic — Vercel deploys from `main` won't see it.
  Can be silenced by setting `turbopack.root` in `next.config.ts` later.
- **npm-audit advisories** bumped to "2 moderate, 1 high" from pdfkit's
  transitive `fontkit` chain. Not reachable from our code path (we never
  let user-supplied fonts near pdfkit). Worth re-checking before
  production.
