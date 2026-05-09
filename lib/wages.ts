/**
 * Ontario hourly minimum-wage presets, effective Oct 1, 2025 –
 * Sep 30, 2026. Update when the province publishes the next adjustment.
 */

export type WagePreset = 'minimum' | 'student' | 'custom'

export const ONTARIO_WAGE_PRESETS = {
  minimum: { label: 'Minimum wage', rate: 17.6 },
  student: { label: 'Student wage', rate: 16.6 },
} as const

export const DEFAULT_WAGE_PRESET: WagePreset = 'minimum'
export const DEFAULT_WAGE_RATE = ONTARIO_WAGE_PRESETS.minimum.rate

/** Map a numeric rate back to the preset that produced it (if any). */
export function inferWagePreset(rate: number): WagePreset {
  if (Math.abs(rate - ONTARIO_WAGE_PRESETS.minimum.rate) < 0.005) return 'minimum'
  if (Math.abs(rate - ONTARIO_WAGE_PRESETS.student.rate) < 0.005) return 'student'
  return 'custom'
}
