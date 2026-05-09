'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  ONTARIO_WAGE_PRESETS,
  inferWagePreset,
  type WagePreset,
} from '@/lib/wages'

/**
 * Inline rate editor for the employees list. Renders a dropdown of wage
 * presets (Min / Student / Custom). Picking a preset auto-saves the matching
 * rate; picking Custom reveals a numeric input that saves on blur/Enter.
 *
 * The component is optimistic: the local state flips first, then the save
 * fires; on failure the previous value is restored and the error surfaces in
 * a small caption.
 */
export function InlineWageEditor({
  id,
  initialRate,
  action,
}: {
  id: string
  initialRate: number
  action: (id: string, rate: number) => Promise<void>
}) {
  const [committed, setCommitted] = useState(initialRate)
  const [preset, setPreset] = useState<WagePreset>(inferWagePreset(initialRate))
  const [customText, setCustomText] = useState(initialRate.toFixed(2))
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const customRef = useRef<HTMLInputElement>(null)

  // When the user picks Custom, focus the number field so they can type
  // immediately without an extra click.
  useEffect(() => {
    if (preset === 'custom') {
      customRef.current?.focus()
      customRef.current?.select()
    }
  }, [preset])

  function save(nextRate: number) {
    if (!Number.isFinite(nextRate) || nextRate < 0) {
      setError('Invalid')
      return
    }
    if (nextRate === committed) return
    setError(null)
    const previous = committed
    setCommitted(nextRate)
    setCustomText(nextRate.toFixed(2))
    startTransition(async () => {
      try {
        await action(id, nextRate)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Save failed')
        setCommitted(previous)
        setCustomText(previous.toFixed(2))
        setPreset(inferWagePreset(previous))
      }
    })
  }

  function onPresetChange(next: WagePreset) {
    setPreset(next)
    if (next === 'custom') {
      // Don't save yet — wait for the user to commit a number.
      return
    }
    save(ONTARIO_WAGE_PRESETS[next].rate)
  }

  function commitCustom() {
    const parsed = Number(customText)
    save(parsed)
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <div className="inline-flex items-center gap-1.5">
        <select
          value={preset}
          disabled={pending}
          onChange={(e) => onPresetChange(e.target.value as WagePreset)}
          aria-label="Wage preset"
          className="rounded-md border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-2 py-1 text-xs"
          // Stop the row's Link from intercepting clicks.
          onClick={(e) => e.stopPropagation()}
        >
          <option value="minimum">
            Min · ${ONTARIO_WAGE_PRESETS.minimum.rate.toFixed(2)}
          </option>
          <option value="student">
            Student · ${ONTARIO_WAGE_PRESETS.student.rate.toFixed(2)}
          </option>
          <option value="custom">Custom</option>
        </select>
        {preset === 'custom' ? (
          <span className="inline-flex items-center gap-1">
            <span className="text-[color:var(--muted)]">$</span>
            <input
              ref={customRef}
              type="number"
              step="0.01"
              min="0"
              value={customText}
              disabled={pending}
              onChange={(e) => setCustomText(e.target.value)}
              onBlur={commitCustom}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  ;(e.target as HTMLInputElement).blur()
                }
                if (e.key === 'Escape') {
                  setCustomText(committed.toFixed(2))
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
              className="w-16 rounded border border-[color:var(--border-strong)] bg-[color:var(--surface)] px-1.5 py-1 text-right text-xs tabular-nums outline-none focus:border-[color:var(--accent)]"
            />
          </span>
        ) : (
          <span className="w-16 text-right text-xs tabular-nums text-[color:var(--muted)]">
            ${committed.toFixed(2)}
          </span>
        )}
      </div>
      {pending && <span className="text-[10px] text-[color:var(--muted)]">saving…</span>}
      {error && <span className="text-[10px] text-rose-600">{error}</span>}
    </div>
  )
}
