'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { bulkImportEmployees, type BulkImportResult } from './actions'

async function downscaleImage(file: File, maxLongSide: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const long = Math.max(bitmap.width, bitmap.height)
  const scale = long > maxLongSide ? maxLongSide / long : 1
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No 2d context')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob failed'))),
      'image/jpeg',
      quality
    )
  })
}

type Candidate = {
  id: string                    // local-only client id
  include: boolean
  full_name: string
  role: string
  hourly_rate: number
  age: string                   // string so empty input stays empty
  default_break_minutes: number
  default_meal_provided: boolean
  confidence: number
  source_note: string | null
  duplicateOfExisting: boolean
}

type ApiResponse = {
  employees?: { name: string; role: string | null; confidence: number; source_note: string | null }[]
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

  const existingLower = new Set(existingNames.map((n) => n.toLowerCase()))

  async function onFileChosen(file: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const isImage = file.type.startsWith('image/')
    setPreviewUrl(isImage ? URL.createObjectURL(file) : null)
    setError(null)
    setStep('extracting')

    // Downscale images before upload so OpenAI doesn't drop the connection
    // on multi-megabyte phone photos. Non-images (CSV, text) go through as-is.
    let uploadBlob: Blob = file
    let uploadName = file.name
    if (isImage) {
      try {
        uploadBlob = await downscaleImage(file, 2000, 0.85)
        uploadName = file.name.replace(/\.[^.]+$/, '') + '.jpg'
      } catch {
        // Fall back to the original file if canvas resize fails.
      }
    }

    const fd = new FormData()
    fd.append('file', uploadBlob, uploadName)
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
        role: e.role?.trim() ?? '',
        hourly_rate: 17.5,
        age: '',
        default_break_minutes: 0,
        default_meal_provided: false,
        confidence: e.confidence,
        source_note: e.source_note,
        duplicateOfExisting: existingLower.has(e.name.trim().toLowerCase()),
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
        role: c.role.trim() || undefined,
        hourly_rate: c.hourly_rate,
        age: c.age === '' ? undefined : Number(c.age),
        default_break_minutes: c.default_break_minutes,
        default_meal_provided: c.default_meal_provided,
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
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-5 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          <p className="font-medium">Imported {result.inserted} employee{result.inserted === 1 ? '' : 's'}.</p>
          {result.skippedDuplicates.length > 0 && (
            <p className="mt-2">Skipped {result.skippedDuplicates.length} duplicate(s): {result.skippedDuplicates.join(', ')}</p>
          )}
          {result.errors.length > 0 && (
            <p className="mt-2">Errors: {result.errors.map((e) => `${e.name}: ${e.message}`).join('; ')}</p>
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
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Review the extracted names. Untick rows you don't want. Default rate is $17.50.
            Yellow rows are low confidence; pink rows are already in your roster.
          </p>
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
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">Sheet image</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,text/csv,text/plain,text/tab-separated-values,.csv,.tsv,.txt"
          disabled={step === 'extracting' || step === 'saving'}
          className="mt-3 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-700 dark:file:bg-zinc-100 dark:file:text-zinc-900 dark:hover:file:bg-zinc-300"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFileChosen(f)
          }}
        />
        <p className="mt-3 text-xs text-zinc-500">
          Image (JPG/PNG/HEIC) → GPT-4o vision · CSV / TSV / TXT → parsed directly (no OCR cost).
          For PDF or Excel, export to CSV first. Up to 10 MB.
        </p>
        {step === 'extracting' && (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-zinc-400" />
            Reading the sheet… (this takes 5–15 seconds)
          </p>
        )}
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Sheet preview" className="max-h-80 w-full rounded object-contain" />
        ) : (
          <div className="flex h-full min-h-40 items-center justify-center px-3 text-center text-xs text-zinc-400">
            Image preview appears here. Text files don’t preview — names show up below.
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
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50">
          <tr>
            <th className="w-10 px-3 py-3"></th>
            <th className="px-3 py-3 font-medium">Name</th>
            <th className="px-3 py-3 font-medium">Role</th>
            <th className="px-3 py-3 font-medium">Rate</th>
            <th className="px-3 py-3 font-medium">Age</th>
            <th className="px-3 py-3 font-medium">Break</th>
            <th className="px-3 py-3 font-medium">Meal</th>
            <th className="px-3 py-3 font-medium">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((c) => {
            const lowConf = c.confidence < 0.7
            const rowClass = c.duplicateOfExisting
              ? 'bg-rose-50 dark:bg-rose-950/30'
              : lowConf
              ? 'bg-amber-50 dark:bg-amber-950/30'
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
                  <input
                    className="input"
                    value={c.role}
                    placeholder="Server"
                    onChange={(e) => onChange(c.id, { role: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    value={c.hourly_rate}
                    onChange={(e) => onChange(c.id, { hourly_rate: Number(e.target.value) })}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    className="input"
                    type="number"
                    min="0"
                    value={c.age}
                    onChange={(e) => onChange(c.id, { age: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2 align-top">
                  <input
                    className="input"
                    type="number"
                    min="0"
                    value={c.default_break_minutes}
                    onChange={(e) => onChange(c.id, { default_break_minutes: Number(e.target.value) })}
                  />
                </td>
                <td className="px-3 py-2 align-top text-center">
                  <input
                    type="checkbox"
                    checked={c.default_meal_provided}
                    onChange={(e) => onChange(c.id, { default_meal_provided: e.target.checked })}
                  />
                </td>
                <td className="px-3 py-2 align-top text-xs text-zinc-500">{c.source_note ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
