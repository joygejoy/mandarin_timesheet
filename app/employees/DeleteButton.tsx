'use client'

import { useTransition } from 'react'

export function DeleteButton({
  action,
  name,
}: {
  action: () => Promise<void>
  name: string
}) {
  const [pending, startTransition] = useTransition()

  function onClick() {
    if (!confirm(`Delete ${name}? Their past shifts and alcohol sales stay (the name is preserved on each row).`)) {
      return
    }
    startTransition(() => action())
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="text-xs text-rose-600 hover:text-rose-800 disabled:opacity-50 dark:text-rose-400 dark:hover:text-rose-300"
    >
      {pending ? 'Deleting…' : 'Delete'}
    </button>
  )
}
