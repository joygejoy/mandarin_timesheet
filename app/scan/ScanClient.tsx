'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { approveScannedSheet, type ApproveInputType } from './actions'
import { EmployeeCombobox } from '@/app/_components/EmployeeCombobox'
import type { Employee } from '@/lib/types/db'

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
  // Snapshot of what the OCR predicted, kept stable across user edits so the
  // review banner can show the model's original guess as evidence.
  predicted_section: string
  predicted_start_time: string
  predicted_end_time: string
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
  scan_image_path?: string | null
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
  const [scanImagePath, setScanImagePath] = useState<string | null>(null)
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

    const fd = new FormData()
    fd.append('file', file, file.name)
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
    setScanImagePath(json.scan_image_path ?? null)
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
      // Anything below 0.8, or anchored on a bracket-shared time, must be
      // verified by the manager — bracket misreads silently propagate to
      // every row in the bracket, so we treat every bracket row as suspect.
      const lowConf = s.confidence < 0.8
      const needsReview =
        lowConf ||
        s.inferred_from_bracket ||
        !employee ||
        !s.start_time ||
        !s.end_time
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
        needs_review: needsReview,
        predicted_section: s.section ?? '',
        predicted_start_time: s.start_time ?? '',
        predicted_end_time: s.end_time ?? '',
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
        predicted_section: '',
        predicted_start_time: '',
        predicted_end_time: '',
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
          scan_image_path: scanImagePath,
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
    setScanImagePath(null)
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

          {flaggedCount > 0 && (
            <div className="rounded-md border-l-4 border-rose-500 bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              <p className="font-semibold">
                {flaggedCount} {flaggedCount === 1 ? 'row needs' : 'rows need'} review
              </p>
              <p className="mt-1 text-xs">
                Rows in red are unreliable: low confidence, bracket-shared times, or missing fields.
                Compare each one against the photo, fix anything wrong, then click <strong>Confirm</strong>.
              </p>
            </div>
          )}

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
  const incomplete = !c.start_time || !c.end_time

  // Cell-level "must review" hints: a field is suspect when the model said so
  // (low overall confidence or bracket-inferred) AND the manager hasn't yet
  // edited the predicted value. Clearing the row's review flag (Confirm)
  // also clears the cell highlights.
  const startSuspect =
    flagged && (lowConf || c.inferred_from_bracket) && c.start_time === c.predicted_start_time
  const endSuspect =
    flagged && (lowConf || c.inferred_from_bracket) && c.end_time === c.predicted_end_time
  const sectionSuspect =
    flagged && lowConf && c.section === c.predicted_section

  const rowClass = !c.include
    ? 'opacity-50'
    : flagged
    ? 'bg-rose-50/70 dark:bg-rose-950/30 border-l-4 border-rose-500'
    : ''
  const suspectCellClass =
    'border-rose-400 ring-1 ring-rose-300 bg-white dark:bg-zinc-900'

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
        {flagged && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded-sm bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
              Must review
            </span>
            <button
              type="button"
              onClick={() => onPatch({ needs_review: false })}
              className="rounded-sm border border-emerald-600 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              Confirm
            </button>
            <span className="text-[10px] text-rose-700 dark:text-rose-300">
              {lowConf && `${Math.round(c.confidence * 100)}% conf`}
              {lowConf && c.inferred_from_bracket && ' · '}
              {c.inferred_from_bracket && 'bracket-shared'}
            </span>
          </div>
        )}
      </td>
      <td className="px-2 py-2 align-top">
        <input
          className={`input w-12 ${sectionSuspect ? suspectCellClass : ''}`}
          maxLength={20}
          value={c.section}
          onChange={(e) => onPatch({ section: e.target.value })}
        />
        {flagged && c.predicted_section && c.section !== c.predicted_section && (
          <p className="mt-1 text-[10px] text-zinc-500">
            model said: <span className="font-medium">{c.predicted_section}</span>
          </p>
        )}
      </td>
      <td className="px-2 py-2 align-top">
        <div className={startSuspect ? `rounded ${suspectCellClass}` : ''}>
          <TimeInput
            value={c.start_time}
            onChange={(v) => onPatch({ start_time: v })}
          />
        </div>
        {flagged && c.predicted_start_time && c.start_time !== c.predicted_start_time && (
          <p className="mt-1 text-[10px] text-zinc-500">
            model said: <span className="font-medium">{formatTime12(c.predicted_start_time)}</span>
          </p>
        )}
      </td>
      <td className="px-2 py-2 align-top">
        <div className={endSuspect ? `rounded ${suspectCellClass}` : ''}>
          <TimeInput
            value={c.end_time}
            onChange={(v) => onPatch({ end_time: v })}
          />
        </div>
        {incomplete && c.include && (
          <p className="mt-1 text-[10px] text-rose-600">missing</p>
        )}
        {flagged && c.predicted_end_time && c.end_time !== c.predicted_end_time && (
          <p className="mt-1 text-[10px] text-zinc-500">
            model said: <span className="font-medium">{formatTime12(c.predicted_end_time)}</span>
          </p>
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

function TimeInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  // Single text input. User types 12-hour with AM/PM ("8:30 PM", "830pm",
  // "8 am", "16:30"); blur parses to canonical 24-hour "HH:MM" for storage.
  // Display is always 12-hour with AM/PM. Restaurant default for ambiguous
  // bare numbers (e.g. "8") is PM since most shifts are evening.
  const [text, setText] = useState(() => formatTime12(value))
  const [prevValue, setPrevValue] = useState(value)
  if (value !== prevValue) {
    setPrevValue(value)
    setText(formatTime12(value))
  }

  function commit() {
    const parsed = parseTime12(text)
    if (parsed === null) {
      // Unparseable — revert display to the last known good value.
      setText(formatTime12(value))
      return
    }
    setText(formatTime12(parsed))
    if (parsed !== value) onChange(parsed)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label="Time"
      className="input w-24 px-2 text-center text-sm tabular-nums"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
      placeholder="8:30 PM"
    />
  )
}

/** "HH:MM" 24-hour → "h:mm AM/PM". Returns "" for empty/invalid input. */
function formatTime12(hhmm: string): string {
  if (!hhmm) return ''
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return ''
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return ''
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(min).padStart(2, '0')} ${period}`
}

/**
 * Parse loose 12-hour input ("8:30 PM", "830pm", "8 am", "16:30", "8") into
 * canonical 24-hour "HH:MM". Returns "" for empty input, null if unparseable.
 */
function parseTime12(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, '')
  if (!s) return ''

  let period: 'am' | 'pm' | null = null
  let body = s
  if (/p\.?m\.?$/.test(s)) {
    period = 'pm'
    body = s.replace(/p\.?m\.?$/, '')
  } else if (/a\.?m\.?$/.test(s)) {
    period = 'am'
    body = s.replace(/a\.?m\.?$/, '')
  } else if (s.endsWith('p')) {
    period = 'pm'
    body = s.slice(0, -1)
  } else if (s.endsWith('a')) {
    period = 'am'
    body = s.slice(0, -1)
  }
  body = body.replace(/[^\d:]/g, '')
  if (!body) return null

  let h = NaN
  let min = 0
  if (body.includes(':')) {
    const [hp, mp = '0'] = body.split(':')
    h = Number(hp)
    min = Number(mp)
  } else if (body.length <= 2) {
    h = Number(body)
    min = 0
  } else if (body.length === 3) {
    h = Number(body.slice(0, 1))
    min = Number(body.slice(1))
  } else if (body.length === 4) {
    h = Number(body.slice(0, 2))
    min = Number(body.slice(2))
  } else {
    return null
  }
  if (!Number.isFinite(h) || !Number.isFinite(min)) return null
  if (min < 0 || min > 59) return null
  if (h < 0) return null

  if (period === 'am') {
    if (h === 12) h = 0
    else if (h > 12) return null
  } else if (period === 'pm') {
    if (h > 12) return null
    if (h !== 12) h += 12
  } else {
    // No period given. Restaurant default: hours 1-11 → PM. 0/12 stay as-is
    // (12 reads as noon; 0 as midnight). Hours 13-23 are already 24-hour.
    if (h >= 1 && h <= 11) h += 12
  }
  if (h > 23) return null

  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}
