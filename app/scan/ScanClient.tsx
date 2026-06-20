'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { approveScannedSheet, type ApproveInputType } from './actions'
import { quickCreateEmployee } from '@/app/employees/actions'
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
  drink_points: number
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

type BatchItem = {
  id: string
  file: File
  previewUrl: string
  date: string
  shiftType: 'lunch' | 'dinner'
  rotation: 0 | 90 | 180 | 270
  /** 'auto' = date came from file metadata; 'manual' = user typed/picked it */
  dateSource: 'auto' | 'manual'
  /**
   * 'pending'    = waiting for user to confirm date/shift before OCR starts
   * 'processing' = OCR request in flight
   * 'done'       = OCR succeeded
   * 'error'      = OCR failed
   */
  ocrStatus: 'pending' | 'processing' | 'done' | 'error'
  ocrResult: ApiResponse | null
  ocrError: string | null
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
  const [step, setStep] = useState<'pick' | 'preview' | 'batch-stage' | 'extracting' | 'review' | 'saving' | 'done'>('pick')
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
  // Single-upload rotation preview before OCR fires
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [singleRotation, setSingleRotation] = useState<0 | 90 | 180 | 270>(0)
  // Rotation that was actually baked into the image sent to OCR — used to keep
  // the preview oriented correctly in the extracting and review steps.
  const [scanRotation, setScanRotation] = useState<0 | 90 | 180 | 270>(0)
  // Single-sheet shift type hint (let user pre-select before scanning)
  const [shiftTypeHint, setShiftTypeHint] = useState<'lunch' | 'dinner' | null>(null)
  // Batch state
  const [batchItems, setBatchItems] = useState<BatchItem[]>([])
  const [batchQueue, setBatchQueue] = useState<BatchItem[]>([])
  const [batchSaved, setBatchSaved] = useState(0)
  const [batchTotal, setBatchTotal] = useState(0)

  const [addedEmployees, setAddedEmployees] = useState<Employee[]>([])
  const allEmployees = useMemo(() => [...employees, ...addedEmployees], [employees, addedEmployees])

  const employeeByLowerName = useMemo(() => {
    const m = new Map<string, Employee>()
    for (const e of allEmployees) m.set(e.full_name.toLowerCase(), e)
    return m
  }, [allEmployees])

  function resolveEmployee(name: string): Employee | undefined {
    return employeeByLowerName.get(name.trim().toLowerCase())
  }

  async function onFileChosen(
    file: File,
    overrideDate?: string,
    overrideShiftType?: 'lunch' | 'dinner',
    preloadedResult?: ApiResponse,
    rotation = 0,
  ) {
    const useDate = overrideDate ?? manualDate
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setError(null)
    setStep('extracting')

    // Always compress+rotate first so the preview URL is a geometrically correct
    // JPEG with no EXIF tricks. CSS transform was the previous approach but it
    // doesn't change the layout box, causing 90°/270° images to overflow their
    // container. The canvas output has rotation baked in and needs no CSS fix.
    const uploadBlob = await compressImage(file, 2048, 0.85, rotation)
    setPreviewUrl(URL.createObjectURL(uploadBlob))
    setScanRotation(0)

    let json: ApiResponse
    if (preloadedResult?.sheet) {
      // Already fetched in the background — skip the network wait entirely.
      json = preloadedResult
    } else {
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
      json = (await res.json().catch(() => ({}))) as ApiResponse
      if (!res.ok || !json.sheet) {
        setError(json.error ?? `HTTP ${res.status}`)
        setStep('pick')
        return
      }
    }

    const sheet = json.sheet!
    setRawOcr(sheet)
    setScanImagePath(json.scan_image_path ?? null)
    setMeta({
      date_iso: sheet.date_iso,
      date_text: sheet.date_text,
      shift_type: sheet.shift_type,
      approved_by_signature: sheet.approved_by_signature,
      notes: sheet.notes,
    })
    setSheetDate(useDate)
    setApprovedBy(sheet.approved_by_signature ?? '')

    const isLunch = (overrideShiftType ?? sheet.shift_type) === 'lunch'

    const built = sheet.shifts.map((s, i): Candidate => {
      const employee = resolveEmployee(s.employee_name)
      const lowConf = s.confidence < 0.8
      const needsReview =
        lowConf ||
        s.inferred_from_bracket ||
        !employee ||
        !s.start_time ||
        !s.end_time

      const rawBreak = s.break_minutes ?? 0
      // "No Break" in notes is authoritative — always 0, even on lunch shifts.
      const noBreak = /no[\s-]?break|\bNB\b/i.test(s.notes ?? '')
      // For lunch, default to 30 when break info is genuinely missing (OCR saw
      // nothing and no annotation). If OCR returned a value, use it.
      const breakMins = noBreak
        ? 0
        : isLunch
          ? rawBreak <= 0 ? 30 : rawBreak < 22.5 ? 15 : 30
          : rawBreak

      // Default meal to provided UNLESS the notes explicitly say "no meal".
      // The OCR returns false as its default (when not mentioned), so we can't
      // trust meal_provided=false alone — we need the text evidence.
      const noMeal = /no[\s-]?meal|\bNM\b/i.test(s.notes ?? '')
      const mealProvided = !noMeal

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
        break_minutes: breakMins,
        meal_provided: mealProvided,
        initials: s.initials ?? '',
        notes: s.notes ?? '',
        drink_points: 0,
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

  // Fire-and-forget OCR for one batch item. Updates batchItems state when done.
  async function startBatchOcr(itemId: string, file: File, rotation = 0) {
    try {
      const blob = await compressImage(file, 2048, 0.85, rotation)
      const fd = new FormData()
      fd.append('file', blob, file.name.replace(/\.[^.]+$/, '.jpg'))
      const res = await fetch('/api/shifts/extract', { method: 'POST', body: fd })
      const json = (await res.json().catch(() => ({}))) as ApiResponse
      if (!res.ok || !json.sheet) {
        setBatchItems((prev) =>
          prev.map((b) => b.id === itemId ? { ...b, ocrStatus: 'error', ocrError: json.error ?? `HTTP ${res.status}` } : b)
        )
      } else {
        setBatchItems((prev) =>
          prev.map((b) => b.id === itemId ? { ...b, ocrStatus: 'done', ocrResult: json } : b)
        )
      }
    } catch (e) {
      setBatchItems((prev) =>
        prev.map((b) => b.id === itemId ? { ...b, ocrStatus: 'error', ocrError: e instanceof Error ? e.message : 'Network error' } : b)
      )
    }
  }

  function onMultipleFilesChosen(files: FileList) {
    const items: BatchItem[] = Array.from(files).map((f, i) => {
      const suggested = extractDateFromFile(f)
      return {
        id: `b${i}`,
        file: f,
        previewUrl: URL.createObjectURL(f),
        date: suggested,
        shiftType: 'dinner' as const,
        rotation: 0 as const,
        dateSource: suggested ? 'auto' as const : 'manual' as const,
        ocrStatus: 'pending' as const,
        ocrResult: null,
        ocrError: null,
      }
    })
    setBatchItems(items)
    setStep('batch-stage')
    // OCR does NOT start automatically — the user must confirm date/shift
    // for each photo first (via the lightbox or the per-card Confirm button).
  }

  function handleBatchRotate(id: string, newRotation: 0 | 90 | 180 | 270) {
    const item = batchItems.find((b) => b.id === id)
    if (!item) return
    if (item.ocrStatus === 'pending') {
      // Not yet confirmed — just update the rotation preview, no OCR yet.
      setBatchItems((prev) =>
        prev.map((b) => b.id === id ? { ...b, rotation: newRotation } : b)
      )
    } else {
      // Already submitted — restart OCR with the new rotation.
      setBatchItems((prev) =>
        prev.map((b) =>
          b.id === id
            ? { ...b, rotation: newRotation, ocrStatus: 'processing', ocrResult: null, ocrError: null }
            : b
        )
      )
      startBatchOcr(id, item.file, newRotation)
    }
  }

  function confirmBatchItem(id: string) {
    const item = batchItems.find((b) => b.id === id)
    if (!item || item.ocrStatus !== 'pending') return
    setBatchItems((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, ocrStatus: 'processing', ocrResult: null, ocrError: null } : b
      )
    )
    startBatchOcr(id, item.file, item.rotation)
  }

  function patchCandidate(id: string, patch: Partial<Candidate>) {
    setCandidates((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }

  function onEmployeeChange(id: string, picked: { id: string | null; label: string }) {
    if (picked.id) {
      const e = allEmployees.find((x) => x.id === picked.id)
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
        meal_provided: true,
        initials: '',
        notes: '',
        drink_points: 0,
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
    const unmatchedNames = candidates
      .filter((c) => c.include && !c.employee_id && c.employee_name.trim())
      .map((c) => c.employee_name.trim())
    if (unmatchedNames.length > 0) {
      setError(
        `Cannot save: ${unmatchedNames.join(', ')} ${unmatchedNames.length === 1 ? 'is' : 'are'} not in the employee roster. Use the "Add to Employees" button on each unmatched row, or deselect those rows.`
      )
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

    const alcoholPoints = candidates
      .filter((c) => c.include && c.employee_name.trim() && c.drink_points > 0 && !isBusperson(c.role))
      .map((c) => ({
        employee_id: c.employee_id,
        employee_name: c.employee_name.trim(),
        drink_points: c.drink_points,
      }))

    setStep('saving')
    startTransition(async () => {
      try {
        const st = meta?.shift_type
        const payload: ApproveInputType = {
          sheet_date: sheetDate,
          approved_by: approvedBy.trim() || null,
          rows,
          raw_ocr: rawOcr,
          scan_image_path: scanImagePath,
          shift_type: st === 'lunch' || st === 'dinner' || st === 'both' ? st : null,
          alcohol_points: alcoholPoints.length > 0 ? alcoholPoints : undefined,
        }
        const result = await approveScannedSheet(payload)
        setSavedSheetId(result.daily_sheet_id)
        setBatchSaved((n) => n + 1)
        setStep('done')
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed')
        setStep('review')
      }
    })
  }

  async function continueToNext() {
    const [next, ...rest] = batchQueue
    setBatchQueue(rest)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setCandidates([])
    setMeta(null)
    setRawOcr(null)
    setScanImagePath(null)
    setSavedSheetId(null)
    setError(null)
    const preloaded = next.ocrStatus === 'done' ? next.ocrResult ?? undefined : undefined
    await onFileChosen(next.file, next.date, next.shiftType, preloaded, next.rotation)
  }

  function reset() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    batchItems.forEach((b) => URL.revokeObjectURL(b.previewUrl))
    batchQueue.forEach((b) => URL.revokeObjectURL(b.previewUrl))
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
    setBatchItems([])
    setBatchQueue([])
    setBatchSaved(0)
    setBatchTotal(0)
    setShiftTypeHint(null)
    setPendingFile(null)
    setSingleRotation(0)
    if (fileInput.current) fileInput.current.value = ''
  }

  // ---- Done ---------------------------------------------------------------

  if (step === 'done' && savedSheetId) {
    const allDone = batchQueue.length === 0
    const isBatch = batchTotal > 1
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
          <p className="text-xl font-semibold">
            {isBatch && allDone ? `All ${batchTotal} sheets saved!` : 'Sheet saved!'}
          </p>
          <p className="mt-1 text-sm text-[color:var(--muted)]">
            {isBatch
              ? `${batchSaved} of ${batchTotal} done`
              : `${candidates.filter((c) => c.include).length} shifts · sheet is in `}
            {!isBatch && (
              <strong className="text-[color:var(--foreground)]">review</strong>
            )}
            {!isBatch && ' status'}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          {!allDone ? (
            <button onClick={continueToNext} className="btn-primary">
              Next sheet ({batchQueue.length} remaining)
            </button>
          ) : (
            <Link href={`/shifts/${savedSheetId}`} className="btn-primary">
              Open the last sheet
            </Link>
          )}
          <button onClick={reset} className="btn-secondary">
            {allDone ? 'Scan more' : 'Stop here'}
          </button>
        </div>
      </div>
    )
  }

  // ---- Batch stage (assign dates + shift types) ---------------------------

  if (step === 'batch-stage') {
    return (
      <BatchStageView
        items={batchItems}
        onUpdate={(id, patch) =>
          setBatchItems((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)))
        }
        onRotate={handleBatchRotate}
        onConfirmItem={confirmBatchItem}
        onConfirm={() => {
          const [first, ...rest] = batchItems
          setBatchQueue(rest)
          setBatchTotal(batchItems.length)
          setBatchSaved(0)
          const preloaded = first.ocrStatus === 'done' ? first.ocrResult ?? undefined : undefined
          onFileChosen(first.file, first.date, first.shiftType, preloaded, first.rotation)
        }}
        onCancel={() => {
          batchItems.forEach((b) => URL.revokeObjectURL(b.previewUrl))
          setBatchItems([])
          setStep('pick')
        }}
      />
    )
  }

  // ---- Rotate preview (single upload) ------------------------------------

  if (step === 'preview' && pendingFile) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <div className="surface p-4">
          <p className="mb-0.5 text-xs font-medium text-[color:var(--muted)]">Sheet date</p>
          <p className="text-sm font-semibold">{manualDate}</p>
        </div>
        <div className="surface p-2">
          {previewUrl && (
            <div className="flex items-center justify-center overflow-hidden rounded" style={{ minHeight: '40vh' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Sheet preview"
                className="max-h-[55vh] max-w-full rounded object-contain"
                style={{ transform: `rotate(${singleRotation}deg)`, transition: 'transform 0.2s ease' }}
              />
            </div>
          )}
          <div className="mt-2 flex items-center justify-center gap-3 pb-1">
            <button
              type="button"
              onClick={() => setSingleRotation((r) => (((r - 90 + 360) % 360) as 0 | 90 | 180 | 270))}
              className="btn-secondary flex h-9 w-9 items-center justify-center text-lg"
              title="Rotate left 90°"
            >↺</button>
            <span className="text-xs text-[color:var(--muted)]">
              {singleRotation !== 0 ? `${singleRotation}° rotated` : 'Rotate if needed'}
            </span>
            <button
              type="button"
              onClick={() => setSingleRotation((r) => (((r + 90) % 360) as 0 | 90 | 180 | 270))}
              className="btn-secondary flex h-9 w-9 items-center justify-center text-lg"
              title="Rotate right 90°"
            >↻</button>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            className="btn-primary"
            onClick={() => {
              const f = pendingFile!
              setPendingFile(null)
              onFileChosen(f, undefined, shiftTypeHint ?? undefined, undefined, singleRotation)
            }}
          >
            Scan
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              if (previewUrl) URL.revokeObjectURL(previewUrl)
              setPreviewUrl(null)
              setPendingFile(null)
              setSingleRotation(0)
              setStep('pick')
            }}
          >
            Choose different
          </button>
        </div>
        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
            {error}
          </div>
        )}
      </div>
    )
  }

  // ---- Pick / extracting --------------------------------------------------

  if (step === 'pick' || step === 'extracting') {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        {step === 'pick' ? (
          <>
            <div className="surface space-y-3 p-4">
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
              <div>
                <p className="mb-1 text-xs font-medium text-[color:var(--muted)]">Shift type</p>
                <div className="flex gap-2">
                  {(['lunch', 'dinner'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setShiftTypeHint((prev) => prev === s ? null : s)}
                      className={shiftTypeHint === s ? 'btn-primary px-3 py-1.5 text-xs' : 'btn-secondary px-3 py-1.5 text-xs'}
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                  <span className="self-center text-[10px] text-[color:var(--muted)]">
                    {shiftTypeHint ? `(${shiftTypeHint} defaults applied)` : '(auto-detect)'}
                  </span>
                </div>
              </div>
            </div>
            <DropZone
              fileInputRef={fileInput}
              onFileChosen={(f) => {
                if (previewUrl) URL.revokeObjectURL(previewUrl)
                setPreviewUrl(URL.createObjectURL(f))
                setPendingFile(f)
                setSingleRotation(0)
                setError(null)
                setStep('preview')
              }}
              onMultipleFilesChosen={onMultipleFilesChosen}
            />
          </>
        ) : (
          <>
            <div className="surface p-4">
              <p className="mb-1 text-xs font-medium text-[color:var(--muted)]">Sheet date</p>
              <p className="text-sm font-semibold">{manualDate}</p>
            </div>
            <ExtractingView previewUrl={previewUrl} rotation={scanRotation} />
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
  const unmatchedCount = candidates.filter((c) => c.include && !c.employee_id && c.employee_name.trim()).length
  const hasServers = candidates.some((c) => !isBusperson(c.role))

  return (
    <div className="space-y-4">
      {batchTotal > 1 && (
        <p className="text-sm text-[color:var(--muted)]">
          Sheet {batchSaved + 1} of {batchTotal}
          {batchQueue.length > 0 && ` · ${batchQueue.length} waiting`}
        </p>
      )}
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
                style={scanRotation ? { transform: `rotate(${scanRotation}deg)` } : undefined}
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
            shiftType={meta?.shift_type ?? null}
            setShiftType={(v) => setMeta((m) => m ? { ...m, shift_type: v } : m)}
          />

          {unmatchedCount > 0 && (
            <div className="surface border-l-2 border-l-rose-500 p-3 text-sm">
              <p className="font-medium text-rose-700 dark:text-rose-400">
                {unmatchedCount} {unmatchedCount === 1 ? 'row has an' : 'rows have'} unmatched employee
              </p>
              <p className="mt-1 text-xs text-[color:var(--muted)]">
                These names were not found in the employee roster. Use the{' '}
                <strong>Add to Employees</strong> button on each row to add them before saving.
              </p>
            </div>
          )}

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
                employees={allEmployees}
                onPatch={(p) => patchCandidate(c.id, p)}
                onEmployeeChange={(picked) => onEmployeeChange(c.id, picked)}
                onEmployeeAdded={(emp) => {
                  setAddedEmployees((prev) => [...prev, emp])
                  patchCandidate(c.id, {
                    employee_id: emp.id,
                    employee_name: emp.full_name,
                    hourly_rate: emp.hourly_rate,
                    role: emp.role ?? '',
                    needs_review: false,
                  })
                }}
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
                  {hasServers && <th className="px-2 py-2.5 font-normal text-center">Pts</th>}
                  <th className="w-10 px-2 py-2.5 font-normal text-center" title="Notes">📝</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {candidates.map((c, rowIdx) => (
                  <Row
                    key={c.id}
                    c={c}
                    rowIdx={rowIdx}
                    employees={allEmployees}
                    onPatch={(p) => patchCandidate(c.id, p)}
                    onEmployeeChange={(picked) => onEmployeeChange(c.id, picked)}
                    onEmployeeAdded={(emp) => {
                      setAddedEmployees((prev) => [...prev, emp])
                      patchCandidate(c.id, {
                        employee_id: emp.id,
                        employee_name: emp.full_name,
                        hourly_rate: emp.hourly_rate,
                        role: emp.role ?? '',
                        needs_review: false,
                      })
                    }}
                    showPoints={hasServers}
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
  onMultipleFilesChosen,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onFileChosen: (file: File) => void
  onMultipleFilesChosen: (files: FileList) => void
}) {
  const [dragOver, setDragOver] = useState(false)

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    if (files.length === 1) {
      if (files[0].type.startsWith('image/')) onFileChosen(files[0])
    } else {
      const images = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (images.length > 0) {
        const dt = new DataTransfer()
        images.forEach((f) => dt.items.add(f))
        onMultipleFilesChosen(dt.files)
      }
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
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
      aria-label="Tap to photograph or drag and drop sheet images"
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
        multiple
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
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
          {dragOver ? 'Drop to scan' : 'Add sheet photos'}
        </p>
        <p className="text-sm text-[color:var(--muted)]">
          Tap to open your camera · select one or multiple sheets
        </p>
        <p className="text-xs text-[color:var(--muted)]">
          JPG · PNG · HEIC · auto-compressed · takes 10–30 s each
        </p>
      </div>
    </div>
  )
}

// ---- ExtractingView ---------------------------------------------------------

function ExtractingView({ previewUrl, rotation = 0 }: { previewUrl: string | null; rotation?: number }) {
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
            style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
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
  onEmployeeAdded,
}: {
  c: Candidate
  index: number
  employees: Employee[]
  onPatch: (p: Partial<Candidate>) => void
  onEmployeeChange: (picked: { id: string | null; label: string }) => void
  onEmployeeAdded: (emp: Employee) => void
}) {
  const flagged = c.needs_review
  const lowConf = c.confidence < 0.8
  const startMissing = !c.start_time
  const endMissing = !c.end_time
  const startSuspect =
    flagged && (lowConf || c.inferred_from_bracket) && c.start_time === c.predicted_start_time && !startMissing
  const endSuspect =
    flagged && (lowConf || c.inferred_from_bracket) && c.end_time === c.predicted_end_time && !endMissing
  const hours = computeShiftHours(c.start_time, c.end_time, c.break_minutes)
  const hoursWarn = c.include && hours !== null && (hours > 7 || hours < 3)

  const isUnmatched = c.include && !c.employee_id && c.employee_name.trim().length > 0
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({ name: c.employee_name, empNumber: '', role: c.role, rate: c.hourly_rate })
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  async function handleQuickAdd() {
    if (!addForm.name.trim()) return
    setAddLoading(true)
    setAddError(null)
    try {
      const emp = await quickCreateEmployee({
        full_name: addForm.name,
        employee_number: addForm.empNumber ? parseInt(addForm.empNumber, 10) : null,
        role: addForm.role || null,
        hourly_rate: addForm.rate,
      })
      onEmployeeAdded(emp as Employee)
      setShowAddForm(false)
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Failed to add employee')
    } finally {
      setAddLoading(false)
    }
  }

  return (
    <div
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className={
        'surface space-y-3 p-4 animate-[fade-in-up_0.3s_ease_both] ' +
        (!c.include ? 'opacity-50' : '') +
        (hoursWarn ? ' ring-1 ring-rose-400 dark:ring-rose-700' : '')
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
          {isUnmatched && !showAddForm && (
            <button
              type="button"
              onClick={() => { setAddForm({ name: c.employee_name, empNumber: '', role: c.role, rate: c.hourly_rate }); setShowAddForm(true) }}
              className="mt-2 btn-secondary px-2 py-1 text-xs text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-700 w-full"
            >
              + Add &ldquo;{c.employee_name}&rdquo; to employees
            </button>
          )}
          {isUnmatched && showAddForm && (
            <div className="mt-2 space-y-1.5 rounded-md border border-rose-300 bg-rose-50/60 dark:border-rose-800 dark:bg-rose-950/30 p-2.5 text-xs">
              <p className="font-medium text-rose-800 dark:text-rose-300">Add to employee roster</p>
              <label className="block">
                <span className="text-[color:var(--muted)]">Name</span>
                <input className="input mt-0.5 w-full" value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
              <label className="block">
                <span className="text-[color:var(--muted)]">Emp #</span>
                <input className="input mt-0.5 w-full" type="number" value={addForm.empNumber} onChange={(e) => setAddForm((f) => ({ ...f, empNumber: e.target.value }))} />
              </label>
              <label className="block">
                <span className="text-[color:var(--muted)]">Role</span>
                <input className="input mt-0.5 w-full" value={addForm.role} placeholder="Server / Busperson" onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))} />
              </label>
              <label className="block">
                <span className="text-[color:var(--muted)]">Rate ($/hr)</span>
                <input className="input mt-0.5 w-full" type="number" step="0.01" value={addForm.rate} onChange={(e) => setAddForm((f) => ({ ...f, rate: Number(e.target.value) }))} />
              </label>
              {addError && <p className="text-rose-700 dark:text-rose-400">{addError}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={handleQuickAdd} disabled={addLoading} className="btn-primary px-3 py-1 text-xs">
                  {addLoading ? 'Saving…' : 'Save employee'}
                </button>
                <button type="button" onClick={() => setShowAddForm(false)} className="btn-secondary px-3 py-1 text-xs">
                  Cancel
                </button>
              </div>
            </div>
          )}
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
              <ReviewHint label="check time" />
            )}
          </CellShell>
        </div>
        <div>
          <p className="mb-1 text-xs text-[color:var(--muted)]">End</p>
          <CellShell tone={endMissing ? 'missing' : endSuspect ? 'review' : null}>
            <TimeInput value={c.end_time} onChange={(v) => onPatch({ end_time: v })} />
            {endMissing && c.include && <ReviewHint label="missing — fill in" />}
            {endSuspect && (
              <ReviewHint label="check time" />
            )}
          </CellShell>
        </div>
      </div>

      {/* Break / Meal / Rate */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="mb-1 text-xs text-[color:var(--muted)]">Break</p>
          <div className="flex gap-1">
            {([0, 15, 30] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onPatch({ break_minutes: m })}
                className={c.break_minutes === m ? 'btn-primary flex-1 py-1.5 text-xs' : 'btn-secondary flex-1 py-1.5 text-xs'}
              >
                {m === 0 ? 'None' : `${m}m`}
              </button>
            ))}
          </div>
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

      {/* Hours warning */}
      {hoursWarn && hours !== null && (
        <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
          ⚠ {hours.toFixed(1)}h — verify shift hours {hours > 7 ? '(unusually long)' : '(unusually short)'}
        </p>
      )}

      {/* Alcohol points — servers only */}
      {!isBusperson(c.role) && (
        <div>
          <p className="mb-1 text-xs text-[color:var(--muted)]">Drink points</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onPatch({ drink_points: Math.max(0, c.drink_points - 1) })}
              disabled={c.drink_points === 0}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[color:var(--border)] text-lg font-medium leading-none text-[color:var(--muted)] transition hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/5"
            >−</button>
            <span className="w-8 text-center text-base font-semibold tabular-nums">{c.drink_points}</span>
            <button
              type="button"
              onClick={() => onPatch({ drink_points: c.drink_points + 1 })}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[color:var(--border)] text-lg font-medium leading-none text-[color:var(--muted)] transition hover:bg-black/5 dark:hover:bg-white/5"
            >+</button>
          </div>
        </div>
      )}

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
  shiftType,
  setShiftType,
}: {
  sheetDate: string
  setSheetDate: (v: string) => void
  approvedBy: string
  setApprovedBy: (v: string) => void
  shiftType: 'lunch' | 'dinner' | 'both' | null
  setShiftType: (v: 'lunch' | 'dinner') => void
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
      <div className="mt-3">
        <p className="mb-1 text-xs text-[color:var(--muted)]">Shift type</p>
        <div className="flex gap-2">
          {(['lunch', 'dinner'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setShiftType(s)}
              className={shiftType === s ? 'btn-primary px-3 py-1.5 text-xs' : 'btn-secondary px-3 py-1.5 text-xs'}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
          {shiftType === 'both' && (
            <span className="self-center text-xs text-[color:var(--muted)]">both (detected)</span>
          )}
          {shiftType === null && (
            <span className="self-center text-xs text-[color:var(--muted)]">not detected</span>
          )}
        </div>
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
  rowIdx,
  employees,
  onPatch,
  onEmployeeChange,
  onEmployeeAdded,
  showPoints,
}: {
  c: Candidate
  rowIdx: number
  employees: Employee[]
  onPatch: (p: Partial<Candidate>) => void
  onEmployeeChange: (picked: { id: string | null; label: string }) => void
  onEmployeeAdded: (emp: Employee) => void
  showPoints: boolean
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

  const hours = computeShiftHours(c.start_time, c.end_time, c.break_minutes)
  const hoursWarn = c.include && hours !== null && (hours > 7 || hours < 3)
  const rowClass = [
    !c.include ? 'opacity-50' : '',
    hoursWarn ? 'bg-rose-50/40 dark:bg-rose-950/20' : '',
  ].join(' ')

  const isUnmatched = c.include && !c.employee_id && c.employee_name.trim().length > 0
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({ name: c.employee_name, empNumber: '', role: c.role, rate: c.hourly_rate })
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  async function handleQuickAdd() {
    if (!addForm.name.trim()) return
    setAddLoading(true)
    setAddError(null)
    try {
      const emp = await quickCreateEmployee({
        full_name: addForm.name,
        employee_number: addForm.empNumber ? parseInt(addForm.empNumber, 10) : null,
        role: addForm.role || null,
        hourly_rate: addForm.rate,
      })
      onEmployeeAdded(emp as Employee)
      setShowAddForm(false)
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Failed to add employee')
    } finally {
      setAddLoading(false)
    }
  }

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
        {isUnmatched && !showAddForm && (
          <button
            type="button"
            onClick={() => { setAddForm({ name: c.employee_name, empNumber: '', role: c.role, rate: c.hourly_rate }); setShowAddForm(true) }}
            className="mt-1.5 btn-secondary px-2 py-1 text-xs text-rose-700 dark:text-rose-400 border-rose-300 dark:border-rose-700"
          >
            + Add &ldquo;{c.employee_name}&rdquo; to employees
          </button>
        )}
        {isUnmatched && showAddForm && (
          <div className="mt-2 space-y-1.5 rounded-md border border-rose-300 bg-rose-50/60 dark:border-rose-800 dark:bg-rose-950/30 p-2.5 text-xs">
            <p className="font-medium text-rose-800 dark:text-rose-300">Add to employee roster</p>
            <label className="block">
              <span className="text-[color:var(--muted)]">Name</span>
              <input className="input mt-0.5 w-full" value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-[color:var(--muted)]">Emp #</span>
              <input className="input mt-0.5 w-full" type="number" value={addForm.empNumber} onChange={(e) => setAddForm((f) => ({ ...f, empNumber: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-[color:var(--muted)]">Role</span>
              <input className="input mt-0.5 w-full" value={addForm.role} placeholder="Server / Busperson" onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))} />
            </label>
            <label className="block">
              <span className="text-[color:var(--muted)]">Rate ($/hr)</span>
              <input className="input mt-0.5 w-full" type="number" step="0.01" value={addForm.rate} onChange={(e) => setAddForm((f) => ({ ...f, rate: Number(e.target.value) }))} />
            </label>
            {addError && <p className="text-rose-700 dark:text-rose-400">{addError}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={handleQuickAdd} disabled={addLoading} className="btn-primary px-3 py-1 text-xs">
                {addLoading ? 'Saving…' : 'Save employee'}
              </button>
              <button type="button" onClick={() => setShowAddForm(false)} className="btn-secondary px-3 py-1 text-xs">
                Cancel
              </button>
            </div>
          </div>
        )}
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
            navRow={rowIdx}
            navCol={1}
          />
          {startMissing && c.include && <ReviewHint label="missing — fill in" />}
          {startSuspect && <ReviewHint label="check time" />}
        </CellShell>
      </td>
      <td className="px-2 py-2 align-top">
        <CellShell tone={endMissing ? 'missing' : endSuspect ? 'review' : null}>
          <TimeInput
            value={c.end_time}
            onChange={(v) => onPatch({ end_time: v })}
            navRow={rowIdx}
            navCol={2}
          />
          {endMissing && c.include && <ReviewHint label="missing — fill in" />}
          {endSuspect && <ReviewHint label="check time" />}
        </CellShell>
      </td>
      <td className="px-2 py-2 align-top">
        <div className="flex gap-1">
          {([0, 15, 30] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onPatch({ break_minutes: m })}
              className={c.break_minutes === m ? 'btn-primary px-1.5 py-1 text-xs' : 'btn-secondary px-1.5 py-1 text-xs'}
            >
              {m === 0 ? 'None' : `${m}m`}
            </button>
          ))}
        </div>
        {hours !== null && (
          <p className={`mt-0.5 text-[10px] tabular-nums ${hoursWarn ? 'font-medium text-rose-600 dark:text-rose-400' : 'text-[color:var(--muted)]'}`}>
            {hours.toFixed(1)}h{hoursWarn ? ' ⚠' : ''}
          </p>
        )}
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
          data-navrow={rowIdx}
          data-navcol={3}
          onKeyDown={(e) => navGridArrow(e, rowIdx, 3)}
        />
      </td>
      {showPoints && (
        <td className="px-2 py-2 text-center align-top">
          {!isBusperson(c.role) ? (
            <div className="flex items-center justify-center gap-0.5">
              <button
                type="button"
                onClick={() => onPatch({ drink_points: Math.max(0, c.drink_points - 1) })}
                disabled={c.drink_points === 0}
                className="flex h-6 w-6 items-center justify-center rounded border border-[color:var(--border)] text-sm text-[color:var(--muted)] transition hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/5"
              >−</button>
              <span className="w-6 text-center text-xs tabular-nums">{c.drink_points}</span>
              <button
                type="button"
                onClick={() => onPatch({ drink_points: c.drink_points + 1 })}
                className="flex h-6 w-6 items-center justify-center rounded border border-[color:var(--border)] text-sm text-[color:var(--muted)] transition hover:bg-black/5 dark:hover:bg-white/5"
              >+</button>
            </div>
          ) : (
            <span className="text-xs text-[color:var(--muted)]">—</span>
          )}
        </td>
      )}
      <td className="px-2 py-2 align-top">
        <NotesCell
          value={c.notes}
          onChange={(v) => onPatch({ notes: v })}
          navRow={rowIdx}
          navCol={4}
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
  navRow,
  navCol,
}: {
  value: string
  onChange: (next: string) => void
  navRow?: number
  navCol?: number
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
        data-navrow={navRow}
        data-navcol={navCol}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Enter') {
            ;(e.target as HTMLInputElement).blur()
          } else if (navRow !== undefined && navCol !== undefined) {
            navGridArrow(e, navRow, navCol)
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
function ReviewHint({ label }: { label: string }) {
  return (
    <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">
      <span className="mr-1">⚠</span>
      {label}
    </p>
  )
}

/**
 * One-line summary shown beside the Confirm button explaining why the row is
 * flagged. Keeps the per-row noise low while pointing at the column(s).
 */
// ---- BatchStageView ---------------------------------------------------------

function BatchStageView({
  items,
  onUpdate,
  onRotate,
  onConfirmItem,
  onConfirm,
  onCancel,
}: {
  items: BatchItem[]
  onUpdate: (id: string, patch: Partial<BatchItem>) => void
  onRotate: (id: string, rotation: 0 | 90 | 180 | 270) => void
  onConfirmItem: (id: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const [lightboxId, setLightboxId] = useState<string | null>(null)
  const lightboxItem = lightboxId ? items.find((b) => b.id === lightboxId) ?? null : null
  const allReady = items.every((b) => b.ocrStatus !== 'pending')
  const autoCount = items.filter((b) => b.dateSource === 'auto').length

  function rotateCW(r: number): 0 | 90 | 180 | 270 {
    return ((r + 90) % 360) as 0 | 90 | 180 | 270
  }
  function rotateCCW(r: number): 0 | 90 | 180 | 270 {
    return ((r - 90 + 360) % 360) as 0 | 90 | 180 | 270
  }

  return (
    <>
      {/* Full-screen lightbox */}
      {lightboxItem && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/95"
          onClick={() => setLightboxId(null)}
        >
          {/* Top bar: close */}
          <div className="flex shrink-0 items-center justify-between px-4 pt-3 pb-2">
            <span className="text-sm font-medium text-white/70">
              {lightboxItem.ocrStatus === 'pending' ? 'Set date & shift, then confirm' : 'Full view'}
            </span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setLightboxId(null)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/25"
            >
              ✕
            </button>
          </div>

          {/* Image */}
          <div className="flex flex-1 items-center justify-center overflow-hidden px-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxItem.previewUrl}
              alt="Sheet"
              style={{
                transform: `rotate(${lightboxItem.rotation}deg)`,
                transition: 'transform 0.2s ease',
                maxHeight: lightboxItem.rotation === 0 || lightboxItem.rotation === 180 ? '65vh' : '65vw',
                maxWidth: lightboxItem.rotation === 0 || lightboxItem.rotation === 180 ? '90vw' : '65vh',
              }}
              className="rounded object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          {/* Bottom controls panel */}
          <div
            className="shrink-0 space-y-3 rounded-t-2xl bg-black/80 px-5 pb-6 pt-4 backdrop-blur-sm"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Rotate row */}
            <div className="flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => onRotate(lightboxItem.id, rotateCCW(lightboxItem.rotation))}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-lg text-white hover:bg-white/30"
                title="Rotate left"
              >↺</button>
              <span className="text-xs text-white/50">
                {lightboxItem.rotation !== 0 ? `${lightboxItem.rotation}° rotated` : 'Rotate if needed'}
              </span>
              <button
                type="button"
                onClick={() => onRotate(lightboxItem.id, rotateCW(lightboxItem.rotation))}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-lg text-white hover:bg-white/30"
                title="Rotate right"
              >↻</button>
            </div>

            {/* Date + shift row */}
            <div className="flex flex-wrap items-end gap-3">
              <label className="block flex-1 min-w-[140px]">
                <span className="mb-1 block text-xs font-medium text-white/60">Date</span>
                <input
                  type="date"
                  value={lightboxItem.date}
                  onChange={(e) =>
                    onUpdate(lightboxItem.id, { date: e.target.value, dateSource: 'manual' })
                  }
                  className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-white/50 focus:outline-none"
                />
              </label>
              <div>
                <p className="mb-1 text-xs font-medium text-white/60">Shift</p>
                <div className="flex gap-2">
                  {(['lunch', 'dinner'] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onUpdate(lightboxItem.id, { shiftType: s })}
                      className={
                        lightboxItem.shiftType === s
                          ? 'rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black'
                          : 'rounded-full border border-white/30 px-4 py-1.5 text-xs text-white/70 hover:border-white/60'
                      }
                    >
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Confirm / close */}
            <div className="flex gap-3 pt-1">
              {lightboxItem.ocrStatus === 'pending' ? (
                <button
                  type="button"
                  onClick={() => {
                    onConfirmItem(lightboxItem.id)
                    setLightboxId(null)
                  }}
                  className="flex-1 rounded-full bg-white py-2.5 text-sm font-semibold text-black hover:bg-white/90"
                >
                  Confirm — start scanning
                </button>
              ) : (
                <div className="flex flex-1 items-center justify-center gap-2 py-2 text-sm text-white/60">
                  {lightboxItem.ocrStatus === 'processing' && (
                    <><span className="h-2 w-2 animate-pulse rounded-full bg-white/60" /> Scanning…</>
                  )}
                  {lightboxItem.ocrStatus === 'done' && (
                    <><span className="text-green-400">✓</span> Scan complete</>
                  )}
                  {lightboxItem.ocrStatus === 'error' && (
                    <><span className="text-rose-400">✗</span> Scan failed — {lightboxItem.ocrError}</>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => setLightboxId(null)}
                className="rounded-full border border-white/20 px-5 py-2.5 text-sm text-white/70 hover:border-white/40"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-lg space-y-4">
        <div>
          <p className="text-sm text-[color:var(--muted)]">
            {items.length} photo{items.length !== 1 ? 's' : ''} selected. Open each photo to verify the date and shift, then tap <strong>Confirm</strong> to start scanning.
          </p>
          {autoCount > 0 && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              ⚠ {autoCount} date{autoCount !== 1 ? 's were' : ' was'} estimated from the file — open the photo to verify.
            </p>
          )}
        </div>

        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={item.id} className="surface flex gap-3 p-3">

              {/* Thumbnail — tap to open full-size lightbox */}
              <div className="flex shrink-0 flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => setLightboxId(item.id)}
                  className="group relative"
                  title="Tap to view full size"
                >
                  <div className="relative h-20 w-20 overflow-hidden rounded">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.previewUrl}
                      alt={`Sheet ${idx + 1}`}
                      className="h-full w-full object-cover"
                      style={{
                        transform: `rotate(${item.rotation}deg)`,
                        transition: 'transform 0.15s',
                      }}
                    />
                  </div>
                  <span className="absolute inset-0 flex items-end justify-center rounded pb-1 transition group-hover:bg-black/20">
                    <span className="rounded bg-black/60 px-1 py-0.5 text-[9px] text-white opacity-0 transition group-hover:opacity-100">
                      view
                    </span>
                  </span>
                  {/* OCR status badge on thumbnail */}
                  <span className="absolute left-0 top-0 m-0.5">
                    {item.ocrStatus === 'pending' && (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[8px] text-white" title="Not yet confirmed">!</span>
                    )}
                    {item.ocrStatus === 'processing' && (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black/60">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                      </span>
                    )}
                    {item.ocrStatus === 'done' && (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[color:var(--tertiary)] text-[8px] text-white">✓</span>
                    )}
                    {item.ocrStatus === 'error' && (
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[8px] text-white" title={item.ocrError ?? ''}>✗</span>
                    )}
                  </span>
                </button>
                {/* Rotate buttons below thumbnail */}
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => onRotate(item.id, rotateCCW(item.rotation))}
                    className="flex h-6 w-6 items-center justify-center rounded text-sm text-[color:var(--muted)] hover:bg-black/5 dark:hover:bg-white/5"
                    title="Rotate left"
                  >↺</button>
                  <button
                    type="button"
                    onClick={() => onRotate(item.id, rotateCW(item.rotation))}
                    className="flex h-6 w-6 items-center justify-center rounded text-sm text-[color:var(--muted)] hover:bg-black/5 dark:hover:bg-white/5"
                    title="Rotate right"
                  >↻</button>
                </div>
              </div>

              <div className="flex-1 space-y-2">
                <p className="text-xs font-medium text-[color:var(--muted)]">Photo {idx + 1}</p>

                <label className="block text-xs">
                  <span className="mb-0.5 flex items-center gap-1.5 text-[color:var(--muted)]">
                    Date
                    {item.dateSource === 'auto' && (
                      <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                        estimated
                      </span>
                    )}
                    {item.dateSource === 'manual' && item.date && (
                      <span className="rounded bg-[color:var(--tertiary-tint)] px-1 py-0.5 text-[9px] font-medium text-[color:var(--tertiary)]">
                        confirmed
                      </span>
                    )}
                  </span>
                  <input
                    type="date"
                    value={item.date}
                    onChange={(e) =>
                      onUpdate(item.id, { date: e.target.value, dateSource: 'manual' })
                    }
                    className="input"
                  />
                </label>

                <div>
                  <p className="mb-0.5 text-xs text-[color:var(--muted)]">Shift</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onUpdate(item.id, { shiftType: 'lunch' })}
                      className={item.shiftType === 'lunch' ? 'btn-primary px-3 py-1 text-xs' : 'btn-secondary px-3 py-1 text-xs'}
                    >
                      Lunch
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdate(item.id, { shiftType: 'dinner' })}
                      className={item.shiftType === 'dinner' ? 'btn-primary px-3 py-1 text-xs' : 'btn-secondary px-3 py-1 text-xs'}
                    >
                      Dinner
                    </button>
                  </div>
                </div>

                {/* Per-card confirm / status */}
                {item.ocrStatus === 'pending' ? (
                  <button
                    type="button"
                    onClick={() => onConfirmItem(item.id)}
                    className="btn-primary w-full py-1.5 text-xs"
                  >
                    Confirm
                  </button>
                ) : (
                  <p className="text-[10px] text-[color:var(--muted)]">
                    {item.ocrStatus === 'processing' && '⏳ Scanning…'}
                    {item.ocrStatus === 'done' && '✓ Ready'}
                    {item.ocrStatus === 'error' && `✗ Error — tap photo to retry`}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            disabled={!allReady}
            className="btn-primary disabled:opacity-50"
          >
            Review {items.length} sheet{items.length !== 1 ? 's' : ''}
          </button>
          <button onClick={onCancel} className="btn-secondary">
            Cancel
          </button>
        </div>
        {!allReady && (
          <p className="text-xs text-[color:var(--muted)]">
            Confirm each photo above to enable this button.
          </p>
        )}
      </div>
    </>
  )
}

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

/**
 * Move focus to an adjacent cell in the scan review table.
 * ArrowUp/Down navigates between rows in the same column.
 * ArrowLeft/Right navigates between columns in the same row (Start→End→Rate→Notes).
 */
function navGridArrow(
  e: React.KeyboardEvent<HTMLInputElement>,
  rowIdx: number,
  colIdx: number
) {
  const isVert = e.key === 'ArrowUp' || e.key === 'ArrowDown'
  const isHoriz = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
  if (!isVert && !isHoriz) return
  e.preventDefault()
  const table = (e.target as HTMLElement).closest('table')
  if (!table) return
  const targetRow = e.key === 'ArrowDown' ? rowIdx + 1 : e.key === 'ArrowUp' ? rowIdx - 1 : rowIdx
  const targetCol = e.key === 'ArrowRight' ? colIdx + 1 : e.key === 'ArrowLeft' ? colIdx - 1 : colIdx
  const el = table.querySelector<HTMLElement>(
    `[data-navrow="${targetRow}"][data-navcol="${targetCol}"]`
  )
  el?.focus()
}

function TimeInput({
  value,
  onChange,
  navRow,
  navCol,
}: {
  value: string
  onChange: (v: string) => void
  navRow?: number
  navCol?: number
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
      data-navrow={navRow}
      data-navcol={navCol}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          ;(e.target as HTMLInputElement).blur()
        } else if (navRow !== undefined && navCol !== undefined) {
          navGridArrow(e, navRow, navCol)
        }
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
 * Try to infer the sheet date from the file before OCR runs.
 * 1. Parse YYYYMMDD out of the filename (Android camera: IMG_20260601_143022.jpg).
 * 2. Fall back to the file's last-modified timestamp.
 */
function extractDateFromFile(file: File): string {
  const m = /(\d{4})(\d{2})(\d{2})/.exec(file.name)
  if (m) {
    const candidate = `${m[1]}-${m[2]}-${m[3]}`
    const dt = new Date(candidate + 'T00:00:00')
    if (!isNaN(dt.getTime()) && dt.getFullYear() >= 2020 && dt.getFullYear() <= 2035) {
      return candidate
    }
  }
  const dt = new Date(file.lastModified)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** Hours worked (start → end minus break), rounded down to the nearest 15-minute interval. Handles midnight crossing. Returns null if times missing. */
function computeShiftHours(startTime: string, endTime: string, breakMinutes: number): number | null {
  if (!startTime || !endTime) return null
  const toMins = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h * 60 + (m || 0)
  }
  let start = toMins(startTime)
  let end = toMins(endTime)
  if (end <= start) end += 24 * 60
  const raw = Math.max(0, end - start - breakMinutes)
  return Math.floor(raw / 15) * 15 / 60
}

/**
 * Resize + re-encode to JPEG so the upload stays under Vercel's 4.5 MB
 * serverless payload limit. Caps the longest side at 2048 px, which matches
 * what OpenAI's vision API processes internally — no accuracy loss.
 */
function isBusperson(role: string | null | undefined): boolean {
  return /bus/i.test(role ?? '')
}

async function compressImage(file: File, maxSide = 2048, quality = 0.85, rotation = 0): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      const swapped = rotation === 90 || rotation === 270
      canvas.width = swapped ? h : w
      canvas.height = swapped ? w : h
      const ctx = canvas.getContext('2d')!
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate((rotation * Math.PI) / 180)
      ctx.drawImage(img, -w / 2, -h / 2, w, h)
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
    // Restaurant default: 10 and 11 are AM (lunch starts); 1-9 and 12 are PM;
    // 0 is midnight; 13-23 are already 24-hour.
    if (h >= 1 && h <= 9) h += 12
  }
  if (h > 23) return null

  // Round minutes DOWN to nearest 15-minute mark (00, 15, 30, 45).
  min = Math.floor(min / 15) * 15

  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}
