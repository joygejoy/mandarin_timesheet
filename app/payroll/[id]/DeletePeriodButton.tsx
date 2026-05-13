'use client'

import { useTransition } from 'react'
import { deletePayPeriod } from '../actions'

export function DeletePeriodButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs text-rose-600 hover:underline disabled:opacity-50"
      onClick={() => {
        if (
          !confirm(
            'Delete this pay period? Daily sheets inside it will be unlinked (not deleted). This cannot be undone.'
          )
        )
          return
        startTransition(() => deletePayPeriod(id))
      }}
    >
      {pending ? '…' : 'Delete period'}
    </button>
  )
}
