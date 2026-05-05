'use client'

import { useState, useTransition } from 'react'

export function RateEditor({
  id,
  initialRate,
  action,
}: {
  id: string
  initialRate: number
  action: (id: string, rate: number) => Promise<void>
}) {
  const [value, setValue] = useState(initialRate.toFixed(2))
  const [committed, setCommitted] = useState(initialRate)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function commit() {
    setError(null)
    const next = Number(value)
    if (!Number.isFinite(next) || next < 0) {
      setError('Invalid')
      setValue(committed.toFixed(2))
      return
    }
    if (next === committed) return
    startTransition(async () => {
      try {
        await action(id, next)
        setCommitted(next)
        setValue(next.toFixed(2))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed')
        setValue(committed.toFixed(2))
      }
    })
  }

  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <div className="inline-flex items-center gap-1">
        <span className="text-zinc-400">$</span>
        <input
          type="number"
          step="0.01"
          min="0"
          value={value}
          disabled={pending}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            }
            if (e.key === 'Escape') {
              setValue(committed.toFixed(2))
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          className="w-20 rounded border border-zinc-300 bg-white px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-100"
        />
      </div>
      {pending && <span className="text-[10px] text-zinc-400">saving…</span>}
      {error && <span className="text-[10px] text-rose-600">{error}</span>}
    </div>
  )
}
