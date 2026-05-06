'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { approveScannedSheet, type ApproveInputType } from './actions'
import { EmployeeCombobox } from '@/app/_components/EmployeeCombobox'
import type { Employee } from '@/lib/types/db'

/**
 * Downscale an image client-side so the OpenAI vision request is small
 * enough to upload reliably. Scales the longest side to maxLongSide,
 * encodes JPEG at the given quality. Returns a Blob suitable for FormData.
 */
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
  id: string
  include: boolean
  employee_id: string | null
  employee_name: string
  hourly_rate: number
  role: string
  section: string
  start_time: string
  end_time: string
  break_minutes: number
  meal_provided: boolean
  initials: string
  notes: string
  confidence: number
  inferred_from_bracket: boolean
  needs_review: boolean
}

type SheetMeta = {
  date_iso: string | null
  date_text: string | null
  shift_type: 'lunch' | 'dinner' | 'both' | null
  approved_by_signature: string | null
  notes: string | null
}

type ApiResponse = {
  sheet?: {
    date_iso: string | null
    date_text: string | null
    shift_type: 'lunch' | 'dinner' | 'both' | null
    approved_by_signature: string | null
    notes: string | null
    shifts: {
      section: string | null
      employee_name: string
      start_time: string | null
      end_time: string | null
      break_minutes: number
      meal_provided: boolean
      initials: string | null
      notes: string | null
      confidence: number
      inferred_from_bracket: boolean
    }[]
  }
  error?: string
}

export function ScanClient({ employees }: { employees: Employee[] }) {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [step, setStep] = useState<'pick' | 'extracting' | 'review' | 'saving' | 'done'>('pick')
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [meta, setMeta] = useState<SheetMeta | null>(null)
  const [rawOcr, setRawOcr] = useState<unknown>(null)
  const [sheetDate, setSheetDate] = useState<string>('')
  const [approvedBy, setApprovedBy] = useState<string>('')
  const [savedSheetId, setSavedSheetId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const employeeByLowerName = useMemo(() => {
    const m = new Map<string, Employee>()
    for (const e of employees) m.set(e.full_name.toLowerCase(), e)
    return m
  }, [employees])

  function resolveEmployee(name: string): Employee | undefined {
    return employeeByLowerName.get(name.trim().toLowerCase())
  }

  async function onFileChosen(file: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(file))
    setError(null)
    setStep('extracting')

    // Downscale before upload so OpenAI doesn't drop the connection.
    let uploadBlob: Blob = file
    try {
      uploadBlob = await downscaleImage(file, 2000, 0.85)
    } catch {
      // Fall back to the original file if canvas resize fails.
    }

    const fd = new FormData()
    const filename = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    fd.append('file', uploadBlob, filename)
    let res: Response
    try {
      res = await fetch('/api/shifts/extract', { method: 'POST', body: fd })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
      setStep('pick')
      return
    }

    const json = (await res.json().catch(() => ({}))) as ApiResponse
    if (!res.ok || !json.sheet) {
      setError(json.error ?? `HTTP ${res.status}`)
      setStep('pick')
      return
    }

    const sheet = json.sheet
    setRawOcr(sheet)
    setMeta({
      date_iso: sheet.date_iso,
      date_text: sheet.date_text,
      shift_type: sheet.shift_type,
      approved_by_signature: sheet.approved_by_signature,
      notes: sheet.notes,
    })
    setSheetDate(sheet.date_iso ?? new Date().toISOString().slice(0, 10))
    setApprovedBy(sheet.approved_by_signature ?? '')

    const built = sheet.shifts.map((s, i): Candidate => {
      const employee = resolveEmployee(s.employee_name)
      const lowConf = s.confidence < 0.7
      return {
        id: `c${i}`,
        include: true,
        employee_id: employee?.id ?? null,
        employee_name: employee?.full_name ?? s.employee_name,
        hourly_rate: employee?.hourly_rate ?? 17.5,
        role: employee?.role ?? '',
        section: s.section ?? '',
        start_time: s.start_time ?? '',
        end_time: s.end_time ?? '',
        break_minutes: s.break_minutes ?? 0,
        meal_provided: s.meal_provided ?? false,
        initials: s.initials ?? '',
        notes: s.notes ?? '',
        confidence: s.confidence,
        inferred_from_bracket: s.inferred_from_bracket,
        needs_review: lowConf || !employee || !s.start_time || !s.end_time,
      }
    })
    setCandidates(built)
    setStep('review')
  }

  function patchCandidate(id: string, patch: Partial<Candidate>) {
    setCandidates((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  function onEmployeeChange(id: string, picked: { id: string | null; label: string }) {
    if (picked.id) {
      const e = employees.find((x) => x.id === picked.id)
      if (e) {
        patchCandidate(id, {
          employee_id: e.id,
          employee_name: e.full_name,
          hourly_rate: e.hourly_rate,
          role: e.role ?? '',
        })
        return
      }
    }
    patchCandidate(id, {
      employee_id: null,
      employee_name: picked.label,
    })
  }

  function addEmptyRow() {
    setCandidates((cs) => [
      ...cs,
      {
        id: `c${cs.length}-${Date.now()}`,
        include: true,
        employee_id: employees[0]?.id ?? null,
        employee_name: employees[0]?.full_name ?? '',
        hourly_rate: employees[0]?.hourly_rate ?? 17.5,
        role: employees[0]?.role ?? '',
        section: '',
        start_time: '',
        end_time: '',
        break_minutes: 0,
        meal_provided: false,
        initials: '',
        notes: '',
        confidence: 1,
        inferred_from_bracket: false,
        needs_review: false,
      },
    ])
  }

  async function onApprove() {
    setError(null)
    if (!sheetDate) {
      setError('Pick a date for this sheet first.')
      return
    }
    const rows = candidates
      .filter((c) => c.include && c.employee_name.trim())
      .map((c) => ({
        employee_id: c.employee_id,
        employee_name: c.employee_name.trim(),
        hourly_rate: c.hourly_rate,
        section: c.section.trim() || null,
        role: c.role.trim() || null,
        start_time: c.start_time || null,
        end_time: c.end_time || null,
        break_minutes: c.break_minutes,
        meal_provided: c.meal_provided,
        initials: c.initials.trim() || null,
        notes: c.notes.trim() || null,
        needs_review: c.needs_review,
        confidence: c.confidence,
      }))
    if (rows.length === 0) {
      setError('No rows selected to save.')
      return
    }

    setStep('saving')
    startTransition(async () => {
      try {
        const payload: ApproveInputType = {
          sheet_date: sheetDate,
          approved_by: approvedBy.trim() || null,
          rows,
          raw_ocr: rawOcr,
        }
        const result = await approveScannedSheet(payload)
        setSavedSheetId(result.daily_sheet_id)
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
    setMeta(null)
    setRawOcr(null)
    setSheetDate('')
    setApprovedBy('')
    setSavedSheetId(null)
    setError(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  // ---- Done ---------------------------------------------------------------

  if (step === 'done' && savedSheetId) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-5 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          <p className="font-medium">Saved {candidates.filter((c) => c.include).length} shifts.</p>
          <p className="mt-1">The sheet is in <strong>review</strong> status. Open it to fix anything else and approve into payroll.</p>
        </div>
        <div className="flex gap-3">
          <Link href={`/shifts/${savedSheetId}`} className="btn-primary">
            Open the new sheet
          </Link>
          <button onClick={reset} className="btn-secondary">
            Scan another
          </button>
        </div>
      </div>
    )
  }

  // ---- Pick / extracting --------------------------------------------------

  if (step === 'pick' || step === 'extracting') {
    return (
      <div className="space-y-4">
        <UploadCard
          fileInputRef={fileInput}
          step={step}
          previewUrl={previewUrl}
          onFileChosen={onFileChosen}
        />
        {error && (
          <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </div>
        )}
      </div>
    )
  }

  // ---- Review -------------------------------------------------------------

  const selectedCount = candidates.filter((c) => c.include).length
  const flaggedCount = candidates.filter((c) => c.include && c.needs_review).length

  return (
    <div className="space-y-4">
      <div className="grid gap-6 md:grid-cols-[minmax(320px,2fr)_3fr]">
        {/* Photo (sticky on desktop) */}
        <div className="md:sticky md:top-6 md:self-start">
          <div className="rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Sheet"
                className="max-h-[80vh] w-full rounded object-contain"
              />
            )}
          </div>
          {meta && <MetaBox meta={meta} />}
        </div>

        {/* Editable rows */}
        <div className="space-y-4">
          <SheetHeader
            sheetDate={sheetDate}
            setSheetDate={setSheetDate}
            approvedBy={approvedBy}
            setApprovedBy={setApprovedBy}
          />

          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50">
                <tr>
                  <th className="w-10 px-2 py-3" />
                  <th className="px-2 py-3 font-medium">Employee</th>
                  <th className="px-2 py-3 font-medium">Sect</th>
                  <th className="px-2 py-3 font-medium">Start</th>
                  <th className="px-2 py-3 font-medium">End</th>
                  <th className="px-2 py-3 font-medium">Brk</th>
                  <th className="px-2 py-3 font-medium text-center">Meal</th>
                  <th className="px-2 py-3 font-medium text-right">Rate</th>
                  <th className="px-2 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {candidates.map((c) => (
                  <Row
                    key={c.id}
                    c={c}
                    employees={employees}
                    onPatch={(p) => patchCandidate(c.id, p)}
                    onEmployeeChange={(picked) => onEmployeeChange(c.id, picked)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={addEmptyRow} className="btn-secondary text-xs">
              + Add row
            </button>
            <p className="text-xs text-zinc-500">
              {selectedCount} selected{flaggedCount > 0 && ` · ${flaggedCount} flagged for review`}
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={onApprove} className="btn-primary" disabled={step === 'saving'}>
              {step === 'saving' ? 'Saving…' : `Save ${selectedCount} shift${selectedCount === 1 ? '' : 's'}`}
            </button>
            <button onClick={reset} className="btn-secondary">
              Start over
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function UploadCard({
  fileInputRef,
  step,
  previewUrl,
  onFileChosen,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  step: string
  previewUrl: string | null
  onFileChosen: (file: File) => void
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Sheet image
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          disabled={step === 'extracting'}
          className="mt-3 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-700 dark:file:bg-zinc-100 dark:file:text-zinc-900"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFileChosen(f)
          }}
        />
        <p className="mt-3 text-xs text-zinc-500">
          On mobile this opens your camera. JPG/PNG/HEIC up to 10 MB. Takes 10–30 seconds.
        </p>
        {step === 'extracting' && (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-zinc-400" />
            Reading the sheet… GPT-4o is parsing handwriting and bracket notation.
          </p>
        )}
      </div>
      <div className="rounded-lg border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Sheet preview" className="max-h-80 w-full rounded object-contain" />
        ) : (
          <div className="flex h-full min-h-40 items-center justify-center text-xs text-zinc-400">
            Preview appears here
          </div>
        )}
      </div>
    </div>
  )
}

function SheetHeader({
  sheetDate,
  setSheetDate,
  approvedBy,
  setApprovedBy,
}: {
  sheetDate: string
  setSheetDate: (v: string) => void
  approvedBy: string
  setApprovedBy: (v: string) => void
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-zinc-600 dark:text-zinc-400">Sheet date</span>
          <input
            type="date"
            required
            value={sheetDate}
            onChange={(e) => setSheetDate(e.target.value)}
            className="input"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-zinc-600 dark:text-zinc-400">Approved by (manager)</span>
          <input
            type="text"
            value={approvedBy}
            onChange={(e) => setApprovedBy(e.target.value)}
            placeholder="LISA"
            className="input"
          />
        </label>
      </div>
    </div>
  )
}

function MetaBox({ meta }: { meta: SheetMeta }) {
  return (
    <div className="mt-3 rounded-md bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-800/40 dark:text-zinc-400">
      <p className="font-medium text-zinc-700 dark:text-zinc-300">What the model saw</p>
      <ul className="mt-2 space-y-1">
        {meta.date_text && <li>Date: {meta.date_text}</li>}
        {meta.shift_type && <li>Shift type: {meta.shift_type}</li>}
        {meta.approved_by_signature && <li>Approval signature: {meta.approved_by_signature}</li>}
        {meta.notes && <li>Other notes: {meta.notes}</li>}
      </ul>
    </div>
  )
}

function Row({
  c,
  employees,
  onPatch,
  onEmployeeChange,
}: {
  c: Candidate
  employees: Employee[]
  onPatch: (p: Partial<Candidate>) => void
  onEmployeeChange: (picked: { id: string | null; label: string }) => void
}) {
  const flagged = c.needs_review
  const lowConf = c.confidence < 0.7
  const rowClass = !c.include
    ? 'opacity-50'
    : flagged
    ? 'bg-amber-50/60 dark:bg-amber-950/20'
    : ''
  const incomplete = !c.start_time || !c.end_time
  return (
    <tr className={rowClass}>
      <td className="px-2 py-2 align-top">
        <input
          type="checkbox"
          checked={c.include}
          onChange={(e) => onPatch({ include: e.target.checked })}
        />
      </td>
      <td className="px-2 py-2 align-top">
        <EmployeeCombobox
          options={employees.map((e) => ({
            id: e.id,
            label: e.full_name,
            sublabel: e.role ?? undefined,
          }))}
          value={c.employee_id}
          customLabel={c.employee_name}
          onChange={onEmployeeChange}
          className="min-w-44"
        />
        {(lowConf || c.inferred_from_bracket) && (
          <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
            {lowConf && `Low confidence ${Math.round(c.confidence * 100)}%`}
            {lowConf && c.inferred_from_bracket && ' · '}
            {c.inferred_from_bracket && 'inferred from bracket'}
          </p>
        )}
      </td>
      <td className="px-2 py-2 align-top">
        <input
          className="input w-12"
          maxLength={20}
          value={c.section}
          onChange={(e) => onPatch({ section: e.target.value })}
        />
      </td>
      <td className="px-2 py-2 align-top">
        <input
          type="time"
          className="input w-24"
          value={c.start_time}
          onChange={(e) => onPatch({ start_time: e.target.value })}
        />
      </td>
      <td className="px-2 py-2 align-top">
        <input
          type="time"
          className="input w-24"
          value={c.end_time}
          onChange={(e) => onPatch({ end_time: e.target.value })}
        />
        {incomplete && c.include && (
          <p className="mt-1 text-[10px] text-rose-600">missing</p>
        )}
      </td>
      <td className="px-2 py-2 align-top">
        <input
          type="number"
          min="0"
          className="input w-16 text-right"
          value={c.break_minutes}
          onChange={(e) => onPatch({ break_minutes: Number(e.target.value) })}
        />
      </td>
      <td className="px-2 py-2 text-center align-top">
        <input
          type="checkbox"
          checked={c.meal_provided}
          onChange={(e) => onPatch({ meal_provided: e.target.checked })}
        />
      </td>
      <td className="px-2 py-2 text-right align-top">
        <input
          type="number"
          step="0.01"
          min="0"
          className="input w-20 text-right"
          value={c.hourly_rate}
          onChange={(e) => onPatch({ hourly_rate: Number(e.target.value) })}
        />
      </td>
      <td className="px-2 py-2 align-top">
        <input
          className="input"
          value={c.notes}
          maxLength={500}
          onChange={(e) => onPatch({ notes: e.target.value })}
        />
      </td>
    </tr>
  )
}
