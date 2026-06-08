'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { bulkImportEmployees, type BulkImportResult } from './actions'
import { normalizeEmployeeName } from '@/lib/normalize'
import { WageSelect } from '@/app/_components/WageSelect'
import { DEFAULT_WAGE_RATE, ONTARIO_WAGE_PRESETS } from '@/lib/wages'

type Candidate = {
  id: string                    // local-only client id
  include: boolean
  full_name: string
  employee_number: string       // string so empty input stays empty
  role: string
  hourly_rate: number
  confidence: number
  source_note: string | null
  duplicateOfExisting: boolean
}

type ApiResponse = {
  employees?: { name: string; role: string | null; employee_number: number | null; confidence: number; source_note: string | null }[]
  error?: string
}

export function ImportClient({ existingNames }: { existingNames: string[] }) {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [step, setStep] = useState<'pick' | 'extracting' | 'review' | 'saving' | 'done'>('pick')
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [result, setResult] = useState<BulkImportResult | null>(null)
  const [, startTransition] = useTransition()

  const existingKeys = new Set(existingNames.map(normalizeEmployeeName))

  async function onFileChosen(file: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const isImage = file.type.startsWith('image/')
    setPreviewUrl(isImage ? URL.createObjectURL(file) : null)
    setError(null)
    setStep('extracting')

    const fd = new FormData()
    fd.append('file', file, file.name)
    let res: Response
    try {
      res = await fetch('/api/employees/extract', { method: 'POST', body: fd })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
      setStep('pick')
      return
    }
    const json = (await res.json().catch(() => ({}))) as ApiResponse
    if (!res.ok) {
      setError(json.error ?? `HTTP ${res.status}`)
      setStep('pick')
      return
    }
    const list = json.employees ?? []
    if (list.length === 0) {
      setError('No names extracted from this image. Try a clearer photo.')
      setStep('pick')
      return
    }
    setCandidates(
      list.map((e, i) => ({
        id: `c${i}`,
        include: true,
        full_name: e.name.trim(),
        employee_number: e.employee_number != null ? String(e.employee_number) : '',
        role: e.role?.trim() ?? '',
        hourly_rate: DEFAULT_WAGE_RATE,
        confidence: e.confidence,
        source_note: e.source_note,
        duplicateOfExisting: existingKeys.has(normalizeEmployeeName(e.name)),
      }))
    )
    setStep('review')
  }

  function updateCandidate(id: string, patch: Partial<Candidate>) {
    setCandidates((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  async function onSave() {
    const rows = candidates
      .filter((c) => c.include && c.full_name.trim().length > 0)
      .map((c) => ({
        full_name: c.full_name.trim(),
        employee_number: c.employee_number === '' ? undefined : Number(c.employee_number),
        role: c.role.trim() || undefined,
        hourly_rate: c.hourly_rate,
      }))
    if (rows.length === 0) {
      setError('Pick at least one row to save.')
      return
    }
    setStep('saving')
    setError(null)
    startTransition(async () => {
      try {
        const r = await bulkImportEmployees(rows)
        setResult(r)
        setStep('done')
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed')
        setStep('review')
      }
    })
  }

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setStep('pick')
    setCandidates([])
    setResult(null)
    setError(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  if (step === 'done' && result) {
    return (
      <div className="space-y-4">
        <div className="surface border-l-2 border-l-emerald-500 p-4 text-sm">
          <p className="font-medium">Imported {result.inserted} employee{result.inserted === 1 ? '' : 's'}.</p>
          {result.skippedDuplicates.length > 0 && (
            <p className="mt-2 text-[color:var(--muted)]">
              Skipped {result.skippedDuplicates.length} duplicate{result.skippedDuplicates.length === 1 ? '' : 's'}: {result.skippedDuplicates.join(', ')}
            </p>
          )}
          {result.errors.length > 0 && (
            <p className="mt-2 text-rose-700 dark:text-rose-300">
              Errors: {result.errors.map((e) => `${e.name}: ${e.message}`).join('; ')}
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <Link href="/employees" className="btn-primary">View employees</Link>
          <button onClick={reset} className="btn-secondary">Import another sheet</button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <UploadCard
        previewUrl={previewUrl}
        step={step}
        fileInputRef={fileInput}
        onFileChosen={onFileChosen}
      />

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
          {error}
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          <p className="text-sm text-[color:var(--muted)]">
            Review the extracted names. Untick rows you don't want. Default rate is Ontario
            minimum wage ($17.60) — pick Student wage ($16.60) per row if applicable.
            Amber rows are low confidence; rose rows are already in your roster.
          </p>
          <BatchWageControls
            onSetAll={(r) =>
              setCandidates((cs) => cs.map((c) => ({ ...c, hourly_rate: r })))
            }
          />
          <CandidateTable rows={candidates} onChange={updateCandidate} />
          <div className="flex items-center gap-3 pt-2">
            <button onClick={onSave} className="btn-primary">
              Save selected ({candidates.filter((c) => c.include).length})
            </button>
            <button onClick={reset} className="btn-secondary">Start over</button>
          </div>
        </div>
      )}
    </div>
  )
}

function UploadCard({
  previewUrl,
  step,
  fileInputRef,
  onFileChosen,
}: {
  previewUrl: string | null
  step: 'pick' | 'extracting' | 'review' | 'saving' | 'done'
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFileChosen: (file: File) => void
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="surface p-4">
        <label className="block text-xs text-[color:var(--muted)]">Sheet</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,text/csv,text/plain,text/tab-separated-values,application/pdf,.csv,.tsv,.txt,.pdf,.xls,.xlsx"
          disabled={step === 'extracting' || step === 'saving'}
          className="mt-2 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[color:var(--foreground)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-[color:var(--background)] hover:file:opacity-85"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFileChosen(f)
          }}
        />
        <p className="mt-3 text-xs text-[color:var(--muted)]">
          Image (JPG/PNG/HEIC) → GPT-4o vision · CSV / TSV / TXT / PDF / XLS / XLSX → parsed
          directly, no OCR cost. Up to 10 MB. Scanned PDFs without a text layer won't work —
          screenshot a page instead.
        </p>
        {step === 'extracting' && (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-[color:var(--muted)]">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[color:var(--accent)]" />
            Reading the sheet… (this takes 5–15 seconds)
          </p>
        )}
      </div>
      <div className="surface p-2">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Sheet preview" className="max-h-80 w-full rounded object-contain" />
        ) : (
          <div className="flex h-full min-h-40 items-center justify-center px-3 text-center text-xs text-[color:var(--muted)]">
            Image preview appears here. Text files don't preview — names show up below.
          </div>
        )}
      </div>
    </div>
  )
}

function CandidateTable({
  rows,
  onChange,
}: {
  rows: Candidate[]
  onChange: (id: string, patch: Partial<Candidate>) => void
}) {
  return (
    <div className="surface overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="border-b border-[color:var(--border)] text-left text-xs font-normal text-[color:var(--muted)]">
          <tr>
            <th className="w-10 px-3 py-2.5"></th>
            <th className="px-3 py-2.5 font-normal">Emp #</th>
            <th className="px-3 py-2.5 font-normal">Name</th>
            <th className="px-3 py-2.5 font-normal">Role</th>
            <th className="px-3 py-2.5 font-normal">Rate</th>
            <th className="px-3 py-2.5 font-normal">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--border)]">
          {rows.map((c) => {
            const lowConf = c.confidence < 0.7
            const rowClass = c.duplicateOfExisting
              ? 'bg-rose-50/40 dark:bg-rose-950/15'
              : lowConf
              ? 'bg-amber-50/40 dark:bg-amber-950/15'
              : ''
            return (
              <tr key={c.id} className={rowClass}>
                <td className="px-3 py-2 align-top">
                  <input
                    type="checkbox"
                    checked={c.include}
                    onChange={(e) => onChange(c.id, { include: e.target.checked })}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    className="input w-20 tabular-nums"
                    type="number"
                    min="1"
                    placeholder="—"
                    value={c.employee_number}
                    onChange={(e) => onChange(c.id, { employee_number: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    className="input"
                    value={c.full_name}
                    onChange={(e) => onChange(c.id, { full_name: e.target.value })}
                  />
                  {c.duplicateOfExisting && (
                    <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">Already in roster</p>
                  )}
                  {!c.duplicateOfExisting && lowConf && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                      Low confidence ({Math.round(c.confidence * 100)}%) — double-check spelling
                    </p>
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  <select
                    className="input"
                    value={c.role}
                    onChange={(e) => onChange(c.id, { role: e.target.value })}
                  >
                    <option value="">—</option>
                    <option value="Server">Server</option>
                    <option value="Busperson">Busperson</option>
                  </select>
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="flex flex-col gap-1">
                    <WageSelect
                      rate={c.hourly_rate}
                      onChange={({ rate }) => onChange(c.id, { hourly_rate: rate })}
                      className="text-xs"
                    />
                    <input
                      className="input w-24 text-right tabular-nums"
                      type="number"
                      step="0.01"
                      min="0"
                      value={c.hourly_rate}
                      onChange={(e) => onChange(c.id, { hourly_rate: Number(e.target.value) })}
                    />
                  </div>
                </td>
                <td className="px-3 py-2 align-top text-xs text-[color:var(--muted)]">{c.source_note ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function BatchWageControls({ onSetAll }: { onSetAll: (rate: number) => void }) {
  return (
    <div className="surface flex flex-wrap items-center gap-3 p-3 text-sm">
      <span className="text-[color:var(--muted)]">Set every row to:</span>
      <button
        type="button"
        onClick={() => onSetAll(ONTARIO_WAGE_PRESETS.minimum.rate)}
        className="btn-secondary text-xs"
      >
        {ONTARIO_WAGE_PRESETS.minimum.label} ${ONTARIO_WAGE_PRESETS.minimum.rate.toFixed(2)}
      </button>
      <button
        type="button"
        onClick={() => onSetAll(ONTARIO_WAGE_PRESETS.student.rate)}
        className="btn-secondary text-xs"
      >
        {ONTARIO_WAGE_PRESETS.student.label} ${ONTARIO_WAGE_PRESETS.student.rate.toFixed(2)}
      </button>
    </div>
  )
}
