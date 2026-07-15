'use client'

import { useState, useTransition } from 'react'
import { updateSheetDate } from '../actions'

export function ChangeDateButton({
  sheetId,
  currentDate,
  weekly = false,
}: {
  sheetId: string
  currentDate: string
  /** Hostess/bar sheets span a week starting on currentDate — label it as such. */
  weekly?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(currentDate)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function cancel() {
    setValue(currentDate)
    setError(null)
    setEditing(false)
  }

  function save() {
    setError(null)
    startTransition(async () => {
      const result = await updateSheetDate(sheetId, value)
      if (result.error) {
        setError(result.error)
      } else {
        setEditing(false)
      }
    })
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {weekly ? `Week of ${fmtWeekRange(currentDate)}` : fmtDateLong(currentDate)}
        </h1>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="btn-ghost text-xs"
        >
          Edit {weekly ? 'week' : 'date'}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') cancel()
          }}
          className="input w-auto"
          autoFocus
          disabled={pending}
        />
        <button
          type="button"
          onClick={save}
          disabled={pending || !value || value === currentDate}
          className="btn-tertiary text-xs"
        >
          {pending ? '…' : 'Save'}
        </button>
        <button type="button" onClick={cancel} className="btn-ghost text-xs" disabled={pending}>
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  )
}

function fmtDateLong(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function fmtWeekRange(startIso: string) {
  const start = new Date(startIso + 'T00:00:00')
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const startLabel = start.toLocaleDateString(undefined, opts)
  const endLabel = end.toLocaleDateString(undefined, { ...opts, year: 'numeric' })
  return `${startLabel} – ${endLabel}`
}
