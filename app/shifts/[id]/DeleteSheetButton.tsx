'use client'

import { useState, useTransition } from 'react'
import { deleteDailySheet } from '../actions'

export function DeleteSheetButton({ sheetId }: { sheetId: string }) {
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  if (confirming) {
    return (
      <span className="flex items-center gap-2">
        <span className="text-xs text-[color:var(--muted)]">Delete sheet + all shifts?</span>
        <button
          type="button"
          disabled={pending}
          className="text-xs font-medium text-rose-600 hover:underline disabled:opacity-50"
          onClick={() => startTransition(() => deleteDailySheet(sheetId))}
        >
          {pending ? '…' : 'Yes, delete'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
        >
          Cancel
        </button>
      </span>
    )
  }

  return (
    <button
      type="button"
      className="text-xs text-rose-600 hover:underline"
      onClick={() => setConfirming(true)}
    >
      Delete sheet
    </button>
  )
}
