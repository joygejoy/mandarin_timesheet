'use client'

import { useTransition } from 'react'
import { deleteDailySheet } from '../actions'

export function DeleteSheetButton({ sheetId }: { sheetId: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs text-rose-600 hover:underline disabled:opacity-50"
      onClick={() => {
        if (!confirm('Delete this sheet and all its shifts? This cannot be undone.')) return
        startTransition(() => deleteDailySheet(sheetId))
      }}
    >
      {pending ? '…' : 'Delete sheet'}
    </button>
  )
}
