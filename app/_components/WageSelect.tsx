'use client'

import { ONTARIO_WAGE_PRESETS, type WagePreset, inferWagePreset } from '@/lib/wages'

/**
 * Small select that picks a wage preset. Picking a preset fills the rate
 * (callers handle that in `onChange`); picking "custom" leaves the rate
 * editable. The displayed preset is derived from the current rate so the
 * select reflects manual edits to the rate input.
 */
export function WageSelect({
  rate,
  onChange,
  className = '',
  disabled = false,
}: {
  rate: number
  onChange: (next: { preset: WagePreset; rate: number }) => void
  className?: string
  disabled?: boolean
}) {
  const preset = inferWagePreset(rate)
  return (
    <select
      value={preset}
      disabled={disabled}
      onChange={(e) => {
        const next = e.target.value as WagePreset
        if (next === 'custom') {
          onChange({ preset: 'custom', rate })
        } else {
          onChange({ preset: next, rate: ONTARIO_WAGE_PRESETS[next].rate })
        }
      }}
      className={`input ${className}`}
    >
      <option value="minimum">
        {ONTARIO_WAGE_PRESETS.minimum.label} (${ONTARIO_WAGE_PRESETS.minimum.rate.toFixed(2)})
      </option>
      <option value="student">
        {ONTARIO_WAGE_PRESETS.student.label} (${ONTARIO_WAGE_PRESETS.student.rate.toFixed(2)})
      </option>
      <option value="custom">Custom</option>
    </select>
  )
}
