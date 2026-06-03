'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { approveScannedSheet, type ApproveInputType } from './actions'
import { EmployeeCombobox } from '@/app/_components/EmployeeCombobox'
import { DEFAULT_WAGE_RATE } from '@/lib/wages'
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

const SCAN_MESSAGES = [
  'Reading handwriting…',
  'Matching employees…',
  'Parsing bracket notation…',
  'Calculating shift hours…',
  'Almost done…',
]

export function ScanClient({ employees }: { employees: Employee[] }) {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [step, setStep] = useState<'pick' | 'extracting' | 'review' | 'saving' | 'done'>('pick')
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [meta, setMeta] = useState<SheetMeta | null>(null)
  const [rawOcr, setRawOcr] = useState<unknown>(null)
  const [manualDate, setManualDate] = useState<string>('')
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
    if (!manualDate) {
      setError('Enter the sheet date before scanning.')
      return
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(URL.createObjectURL(file))
    setError(null)
    setStep('extracting')

    // Vercel caps serverless payloads at 4.5 MB. Phone cameras produce 8–15 MB
    // JPEGs, so compress client-side first. OpenAI's vision API processes images
    // at 2048 px max anyway, so accuracy is unchanged.
    const uploadBlob = await compressImage(file)

    const fd = new FormData()
    fd.append('file', uploadBlob, file.name.replace(/\.[^.]+$/, '.jpg'))
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
    setSheetDate(manualDate)
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
        hourly_rate: employee?.hourly_rate ?? DEFAULT_WAGE_RATE,
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
        employee_id: null,
        employee_name: '',
        hourly_rate: DEFAULT_WAGE_RATE,
        role: '',
        section: '',
        start_time: '',
        end_time: '',
        break_minutes: 0,
        meal_provided: false,
        initials: '',
        notes: '',
        confidence: 1,
        inferred_from_bracket: false,
        needs_review: true,
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
    setManualDate('')
    setSheetDate('')
    setApprovedBy('')
    setSavedSheetId(null)
    setError(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  // ---- Done ---------------------------------------------------------------

  if (step === 'done' && savedSheetId) {
    return (
      <div className="flex flex-col items-center gap-6 py-16 text-center animate-[fade-in-up_0.4s_ease_both]">
        <div className="animate-[success-pop_0.5s_cubic-bezier(0.34,1.56,0.64,1)_both]">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-full"
            style={{ backgroundColor: 'var(--success-tint)' }}
          >
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden>
              <path
                d="M10 21 L16.5 27.5 L30 13"
                stroke="var(--tertiary)"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
        <div>
          <p className="text-xl font-semibold">Sheet saved!</p>
          <p className="mt-1 text-sm text-[color:var(--muted)]">
            {candidates.filter((c) => c.include).length} shifts ·{' '}
            sheet is in{' '}
            <strong className="text-[color:var(--foreground)]">review</strong> status
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
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
      <div className="mx-auto max-w-lg space-y-4">
        {step === 'pick' ? (
          <>
            <div className="surface p-4">
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-[color:var(--muted)]">
                  Sheet date <span className="text-rose-500">*</span>
                </span>
                <input
                  type="date"
                  required
                  value={manualDate}
                  onChange={(e) => setManualDate(e.target.value)}
                  className="input"
                  aria-label="Date of the timesheet"
                />
              </label>
              <p className="mt-1.5 text-xs text-[color:var(--muted)]">
                Enter the date on the paper sheet before scanning.
              </p>
            </div>
            <DropZone fileInputRef={fileInput} onFileChosen={onFileChosen} />
          </>
        ) : (
          <>
            <div className="surface p-4">
              <p className="mb-1 text-xs font-medium text-[color:var(--muted)]">Sheet date</p>
              <p className="text-sm font-semibold">{manualDate}</p>
            </div>
            <ExtractingView previewUrl={previewUrl} />
          </>
        )}
        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
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
          <div className="surface p-2">
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
            <div className="surface border-l-2 border-l-amber-500 p-3 text-sm">
              <p className="font-medium">
                {flaggedCount} {flaggedCount === 1 ? 'row needs' : 'rows need'} review
              </p>
              <p className="mt-1 text-xs text-[color:var(--muted)]">
                <span className="inline-flex items-center gap-1.5 mr-3">
                  <span className="inline-block h-2 w-2 rounded-sm bg-amber-400" /> verify this cell
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-sm bg-rose-400" /> empty — fill in
                </span>
                <span className="ml-1">
                  — fix the highlighted cells, then click the green{' '}
                  <strong>Confirm</strong> button on each row.
                </span>
              </p>
            </div>
          )}

          {/* Mobile: stacked shift cards */}
          <div className="space-y-3 md:hidden">
            {candidates.map((c, i) => (
              <ShiftCard
                key={c.id}
                c={c}
                index={i}
                employees={employees}
                onPatch={(p) => patchCandidate(c.id, p)}
                onEmployeeChange={(picked) => onEmployeeChange(c.id, picked)}
              />
            ))}
          </div>

          {/* Desktop: table */}
          <div className="surface hidden overflow-x-auto md:block">
            <table className="min-w-full text-sm">
              <thead className="border-b border-[color:var(--border)] text-left text-xs font-normal text-[color:var(--muted)]">
                <tr>
                  <th className="w-10 px-2 py-2.5" />
                  <th className="px-2 py-2.5 font-normal">Employee</th>
                  <th className="px-2 py-2.5 font-normal">Start</th>
                  <th className="px-2 py-2.5 font-normal">End</th>
                  <th className="px-2 py-2.5 font-normal">Brk</th>
                  <th className="px-2 py-2.5 font-normal text-center">Meal</th>
                  <th className="px-2 py-2.5 font-normal text-right">Rate</th>
                  <th className="w-10 px-2 py-2.5 font-normal text-center" title="Notes">📝</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
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
            <p className="text-xs text-[color:var(--muted)]">
              {selectedCount} selected{flaggedCount > 0 && ` · ${flaggedCount} flagged for review`}
            </p>
          </div>

          {error && (
            <div className="rounded-md border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
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

// ---- DropZone ---------------------------------------------------------------

function DropZone({
  fileInputRef,
  onFileChosen,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFileChosen: (file: File) => void
}) {
  const [dragOver, setDragOver] = useState(false)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('image/')) onFileChosen(file)
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click()
      }}
      aria-label="Tap to photograph or drag and drop a sheet image"
      className={
        'surface flex min-h-64 cursor-pointer select-none flex-col items-center justify-center gap-5 p-10 text-center transition-[border-color,background-color] duration-200 ' +
        (dragOver
          ? 'border-[color:var(--primary)] bg-[color:var(--accent-tint)]'
          : 'border-dashed hover:border-[color:var(--border-strong)] hover:bg-black/[0.015] dark:hover:bg-white/[0.015]')
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFileChosen(f)
        }}
      />

      {/* Camera icon */}
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl transition-transform duration-200"
        style={{ backgroundColor: 'var(--accent-tint)' }}
      >
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
          <circle cx="16" cy="17" r="5" stroke="var(--primary)" strokeWidth="2" />
          <path
            d="M4 12.5C4 10.567 5.567 9 7.5 9H10l1.5-2.5A1 1 0 0 1 12.5 6h7a1 1 0 0 1 .866.5L22 9h2.5C26.433 9 28 10.567 28 12.5V23c0 1.933-1.567 3.5-3.5 3.5h-17C5.567 26.5 4 24.933 4 23V12.5Z"
            stroke="var(--primary)"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <div className="space-y-1.5">
        <p className="text-base font-semibold text-[color:var(--foreground)]">
          {dragOver ? 'Drop to scan' : 'Add a sheet photo'}
        </p>
        <p className="text-sm text-[color:var(--muted)]">
          Tap to open your camera, or drag an image here
        </p>
        <p className="text-xs text-[color:var(--muted)]">
          JPG · PNG · HEIC · auto-compressed · takes 10–30 s
        </p>
      </div>
    </div>
  )
}

// ---- ExtractingView ---------------------------------------------------------

function ExtractingView({ previewUrl }: { previewUrl: string | null }) {
  const [msgIdx, setMsgIdx] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setMsgIdx((i) => (i + 1) % SCAN_MESSAGES.length), 2400)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="surface overflow-hidden">
      {previewUrl ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Sheet being scanned"
            className="max-h-96 w-full object-contain"
          />
          {/* Animated scan line sweeping top → bottom */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 right-0 h-[3px] animate-[scan-sweep_2s_ease-in-out_infinite_alternate] rounded-full"
            style={{
              background: 'linear-gradient(to right, var(--primary), var(--accent), var(--tertiary))',
            }}
          />
          {/* Status overlay */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-4 pt-10">
            <p className="flex items-center gap-2.5 text-sm font-medium text-white">
              <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-[color:var(--accent)]" />
              {SCAN_MESSAGES[msgIdx]}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center p-16">
          <p className="flex items-center gap-2.5 text-sm text-[color:var(--muted)]">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[color:var(--accent)]" />
            {SCAN_MESSAGES[msgIdx]}
          </p>
        </div>
      )}
    </div>
  )
}

// ---- ShiftCard (mobile stacked layout) --------------------------------------

function ShiftCard({
  c,
  index,
  employees,
  onPatch,
  onEmployeeChange,
}: {
  c: Candidate
  index: number
  employees: Employee[]
  onPatch: (p: Partial<Candidate>) => void
  onEmployeeChange: (picked: { id: string | null; label: string }) => void
}) {
  const flagged = c.needs_review
  const lowConf = c.confidence < 0.8
  const startMissing = !c.start_time
  const endMissing = !c.end_time
  const startSuspect =
    flagged && (lowConf || c.inferred_from_bracket) && c.start_time === c.predicted_start_time && !startMissing
  const endSuspect =
    flagged && (lowConf || c.inferred_from_bracket) && c.end_time === c.predicted_end_time && !endMissing

  return (
    <div
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className={
        'surface space-y-3 p-4 animate-[fade-in-up_0.3s_ease_both] ' +
        (!c.include ? 'opacity-50' : '')
      }
    >
      {/* Checkbox + employee */}
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={c.include}
          onChange={(e) => onPatch({ include: e.target.checked })}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--primary)]"
        />
        <div className="min-w-0 flex-1">
          <EmployeeCombobox
            options={employees.map((e) => ({
              id: e.id,
              label: e.full_name,
              sublabel: e.role ?? undefined,
            }))}
            value={c.employee_id}
            customLabel={c.employee_name}
            onChange={onEmployeeChange}
          />
          {flagged && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onPatch({ needs_review: false })}
                className="btn-tertiary px-3 py-1 text-xs"
                title="Mark this row as confirmed and clear the cell highlights"
              >
                ✓ Confirm
              </button>
              <span className="text-[10px] text-[color:var(--muted)]">
                {summarizeReviewReason({ lowConf, c, startMissing, endMissing, startSuspect, endSuspect, sectionSuspect: false })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Start / End */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="mb-1 text-xs text-[color:var(--muted)]">Start</p>
          <CellShell tone={startMissing ? 'missing' : startSuspect ? 'review' : null}>
            <TimeInput value={c.start_time} onChange={(v) => onPatch({ start_time: v })} />
            {startMissing && c.include && <ReviewHint label="missing — fill in" />}
            {startSuspect && (
              <ReviewHint
                label="check time"
                modelSaid={c.predicted_start_time ? formatTime12(c.predicted_start_time) : null}
              />
            )}
          </CellShell>
        </div>
        <div>
          <p className="mb-1 text-xs text-[color:var(--muted)]">End</p>
          <CellShell tone={endMissing ? 'missing' : endSuspect ? 'review' : null}>
            <TimeInput value={c.end_time} onChange={(v) => onPatch({ end_time: v })} />
            {endMissing && c.include && <ReviewHint label="missing — fill in" />}
            {endSuspect && (
              <ReviewHint
                label="check time"
                modelSaid={c.predicted_end_time ? formatTime12(c.predicted_end_time) : null}
              />
            )}
          </CellShell>
        </div>
      </div>

      {/* Break / Meal / Rate */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="mb-1 text-xs text-[color:var(--muted)]">Break (min)</p>
          <input
            type="number"
            min="0"
            className="input w-full text-right"
            value={c.break_minutes}
            onChange={(e) => onPatch({ break_minutes: Number(e.target.value) })}
          />
        </div>
        <div className="flex flex-col items-center justify-end gap-1 pb-2">
          <p className="text-xs text-[color:var(--muted)]">Meal</p>
          <input
            type="checkbox"
            checked={c.meal_provided}
            onChange={(e) => onPatch({ meal_provided: e.target.checked })}
            className="h-5 w-5 accent-[color:var(--primary)]"
          />
        </div>
        <div>
          <p className="mb-1 text-xs text-[color:var(--muted)]">Rate ($/h)</p>
          <input
            type="number"
            step="0.01"
            min="0"
            className="input w-full text-right"
            value={c.hourly_rate}
            onChange={(e) => onPatch({ hourly_rate: Number(e.target.value) })}
          />
        </div>
      </div>

      {/* Notes — always visible in the card layout */}
      <div>
        <p className="mb-1 text-xs text-[color:var(--muted)]">Notes</p>
        <input
          type="text"
          className="input"
          value={c.notes}
          maxLength={500}
          placeholder="Add notes…"
          onChange={(e) => onPatch({ notes: e.target.value })}
        />
      </div>
    </div>
  )
}

// ---- SheetHeader ------------------------------------------------------------

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
    <div className="surface p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-[color:var(--muted)]">Sheet date</span>
          <input
            type="date"
            required
            value={sheetDate}
            onChange={(e) => setSheetDate(e.target.value)}
            className="input"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-[color:var(--muted)]">Approved by (manager)</span>
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

// ---- MetaBox ----------------------------------------------------------------

function MetaBox({ meta }: { meta: SheetMeta }) {
  return (
    <div className="mt-3 rounded-md border border-[color:var(--border)] bg-[color:var(--background)] p-3 text-xs text-[color:var(--muted)]">
      <p className="text-[color:var(--foreground)]">What the model saw</p>
      <ul className="mt-2 space-y-1">
        {meta.date_text && <li>Date: {meta.date_text}</li>}
        {meta.shift_type && <li>Shift type: {meta.shift_type}</li>}
        {meta.approved_by_signature && <li>Approval signature: {meta.approved_by_signature}</li>}
        {meta.notes && <li>Other notes: {meta.notes}</li>}
      </ul>
    </div>
  )
}

// ---- Row (desktop table row) ------------------------------------------------

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
  // Match the row-level threshold from onFileChosen so cells inside a
  // flagged row actually get highlighted. Previously this used <0.7 while
  // the row used <0.8, leaving a 0.7–0.8 dead zone where the row was
  // flagged but no individual cell got an amber wrapper.
  const lowConf = c.confidence < 0.8
  const startMissing = !c.start_time
  const endMissing = !c.end_time

  // Cell-level "must review" hints: a field is suspect when the model said so
  // (low overall confidence or bracket-inferred) AND the manager hasn't yet
  // edited the predicted value. Clearing the row's review flag (Confirm)
  // also clears the cell highlights.
  const startSuspect =
    flagged && (lowConf || c.inferred_from_bracket) && c.start_time === c.predicted_start_time && !startMissing
  const endSuspect =
    flagged && (lowConf || c.inferred_from_bracket) && c.end_time === c.predicted_end_time && !endMissing
  const sectionSuspect =
    flagged && lowConf && c.section === c.predicted_section

  const rowClass = !c.include ? 'opacity-50' : ''

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
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onPatch({ needs_review: false })}
              className="btn-tertiary px-3 py-1 text-xs"
              title="Mark this row as confirmed and clear the cell highlights"
            >
              ✓ Confirm
            </button>
            <span className="text-[10px] text-[color:var(--muted)]">
              {summarizeReviewReason({ lowConf, c, startMissing, endMissing, startSuspect, endSuspect, sectionSuspect: false })}
            </span>
          </div>
        )}
      </td>
      <td className="px-2 py-2 align-top">
        <CellShell tone={startMissing ? 'missing' : startSuspect ? 'review' : null}>
          <TimeInput
            value={c.start_time}
            onChange={(v) => onPatch({ start_time: v })}
          />
          {startMissing && c.include && <ReviewHint label="missing — fill in" />}
          {startSuspect && (
            <ReviewHint
              label="check time"
              modelSaid={c.predicted_start_time ? formatTime12(c.predicted_start_time) : null}
            />
          )}
        </CellShell>
      </td>
      <td className="px-2 py-2 align-top">
        <CellShell tone={endMissing ? 'missing' : endSuspect ? 'review' : null}>
          <TimeInput
            value={c.end_time}
            onChange={(v) => onPatch({ end_time: v })}
          />
          {endMissing && c.include && <ReviewHint label="missing — fill in" />}
          {endSuspect && (
            <ReviewHint
              label="check time"
              modelSaid={c.predicted_end_time ? formatTime12(c.predicted_end_time) : null}
            />
          )}
        </CellShell>
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
        <NotesCell
          value={c.notes}
          onChange={(v) => onPatch({ notes: v })}
        />
      </td>
    </tr>
  )
}

/**
 * Notes cell collapsed by default to keep the row compact. A small icon
 * button reveals the input inline; blur (or Escape) collapses it back. The
 * icon turns blue when the cell already holds text so the manager can tell
 * which rows have notes at a glance.
 */
function NotesCell({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus the input when the cell expands.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (open) {
    return (
      <input
        ref={inputRef}
        className="input w-56"
        value={value}
        maxLength={500}
        placeholder="Notes…"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter') {
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
    )
  }

  const hasNotes = value.trim().length > 0
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title={hasNotes ? value : 'Add notes'}
      aria-label={hasNotes ? `Notes: ${value}` : 'Add notes'}
      className={
        'flex h-8 w-8 items-center justify-center rounded-md text-base transition ' +
        (hasNotes
          ? 'bg-[color:var(--primary-container)] text-[color:var(--on-primary-container)] hover:bg-[color:var(--primary-container)]/85'
          : 'text-[color:var(--muted)] hover:bg-black/5 dark:hover:bg-white/5')
      }
    >
      📝
    </button>
  )
}

/**
 * Wraps a cell input with a tone-coded background so the manager can spot
 * exactly which cell needs attention without scanning every column.
 *   - 'review'  = OCR is uncertain (amber)
 *   - 'missing' = required field is empty (rose)
 */
function CellShell({
  tone,
  children,
}: {
  tone: 'review' | 'missing' | null
  children: React.ReactNode
}) {
  if (!tone) return <>{children}</>
  const cls =
    tone === 'review'
      ? 'rounded-md bg-amber-100/70 p-1.5 ring-1 ring-amber-400 dark:bg-amber-900/25 dark:ring-amber-700'
      : 'rounded-md bg-rose-100/70 p-1.5 ring-1 ring-rose-400 dark:bg-rose-900/25 dark:ring-rose-700'
  return <div className={cls}>{children}</div>
}

/**
 * Inline caption inside a flagged cell — keeps the "this needs your eyes" cue
 * and the OCR's original guess together so the manager can verify in place.
 */
function ReviewHint({
  label,
  modelSaid,
}: {
  label: string
  modelSaid?: string | null
}) {
  return (
    <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">
      <span className="mr-1">⚠</span>
      {label}
      {modelSaid && (
        <span className="ml-1 font-normal normal-case text-[color:var(--muted)]">
          (model: <span className="font-medium text-[color:var(--foreground)]">{modelSaid}</span>)
        </span>
      )}
    </p>
  )
}

/**
 * One-line summary shown beside the Confirm button explaining why the row is
 * flagged. Keeps the per-row noise low while pointing at the column(s).
 */
function summarizeReviewReason({
  lowConf,
  c,
  startMissing,
  endMissing,
  startSuspect,
  endSuspect,
}: {
  lowConf: boolean
  c: Candidate
  startMissing: boolean
  endMissing: boolean
  startSuspect: boolean
  endSuspect: boolean
  // Accepted but unused — kept so existing callers remain stable.
  sectionSuspect?: boolean
}): string {
  const parts: string[] = []
  if (startMissing) parts.push('start (empty)')
  else if (startSuspect) parts.push('start')
  if (endMissing) parts.push('end (empty)')
  else if (endSuspect) parts.push('end')
  if (parts.length === 0) {
    if (lowConf) return `${Math.round(c.confidence * 100)}% confidence`
    if (c.inferred_from_bracket) return 'bracket-shared time'
    return 'verify all fields'
  }
  return `verify: ${parts.join(', ')}`
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
 * Resize + re-encode to JPEG so the upload stays under Vercel's 4.5 MB
 * serverless payload limit. Caps the longest side at 2048 px, which matches
 * what OpenAI's vision API processes internally — no accuracy loss.
 */
async function compressImage(file: File, maxSide = 2048, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Image compression failed'))),
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')) }
    img.src = url
  })
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
