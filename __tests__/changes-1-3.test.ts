/**
 * Tests for the three scan/payroll changes:
 *
 * Change 1 – Unmatched employee blocking logic
 *   The approve guard derives `unmatchedIncluded` from the candidate list.
 *   We test that logic in isolation here (no DOM needed).
 *
 * Change 2 – Meal defaults to true unless "no meal" is in notes
 *   We replicate the exact expression from ScanClient.tsx.
 *
 * Change 3 – Hours/minutes rounded DOWN to nearest 15-minute interval
 *   Covers shiftPaidMinutes() in lib/payroll.ts.
 */

import { describe, it, expect } from 'vitest'
import { shiftPaidMinutes } from '../lib/payroll'

// ---------------------------------------------------------------------------
// Helpers shared with the scan page (reproduced inline for isolation)
// ---------------------------------------------------------------------------

function mealProvided(notes: string): boolean {
  const noMeal = /no[\s-]?meal|\bNM\b/i.test(notes)
  return !noMeal
}

type Candidate = {
  include: boolean
  employee_id: string | null
  employee_name: string
}

function unmatchedIncluded(candidates: Candidate[]): Candidate[] {
  return candidates.filter((c) => c.include && !c.employee_id && c.employee_name.trim())
}

// ---------------------------------------------------------------------------
// Change 1 – Unmatched employee detection
// ---------------------------------------------------------------------------

describe('Change 1 – unmatched employee blocking', () => {
  it('allows save when all included candidates are matched', () => {
    const candidates: Candidate[] = [
      { include: true, employee_id: 'uuid-1', employee_name: 'Alice' },
      { include: true, employee_id: 'uuid-2', employee_name: 'Bob' },
    ]
    expect(unmatchedIncluded(candidates)).toHaveLength(0)
  })

  it('blocks save when an included candidate has no employee_id', () => {
    const candidates: Candidate[] = [
      { include: true, employee_id: 'uuid-1', employee_name: 'Alice' },
      { include: true, employee_id: null, employee_name: 'Melissa' },
    ]
    expect(unmatchedIncluded(candidates)).toHaveLength(1)
    expect(unmatchedIncluded(candidates)[0].employee_name).toBe('Melissa')
  })

  it('does NOT block when an unmatched candidate is unchecked (include=false)', () => {
    const candidates: Candidate[] = [
      { include: true,  employee_id: 'uuid-1', employee_name: 'Alice' },
      { include: false, employee_id: null,     employee_name: 'Melissa' },
    ]
    expect(unmatchedIncluded(candidates)).toHaveLength(0)
  })

  it('ignores blank employee_name rows (empty add-row)', () => {
    const candidates: Candidate[] = [
      { include: true, employee_id: null, employee_name: '   ' },
    ]
    expect(unmatchedIncluded(candidates)).toHaveLength(0)
  })

  it('returns all unmatched when multiple rows lack an employee_id', () => {
    const candidates: Candidate[] = [
      { include: true, employee_id: null, employee_name: 'Melissa' },
      { include: true, employee_id: null, employee_name: 'Jordan' },
      { include: true, employee_id: 'uuid-3', employee_name: 'Charlie' },
    ]
    expect(unmatchedIncluded(candidates)).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Change 2 – Meal default is true unless "no meal" is in notes
// ---------------------------------------------------------------------------

describe('Change 2 – meal defaults to checked', () => {
  it('defaults to true when notes is empty', () => {
    expect(mealProvided('')).toBe(true)
  })

  it('defaults to true when notes do not mention meal', () => {
    expect(mealProvided('Late arrival')).toBe(true)
  })

  it('is false when notes say "no meal"', () => {
    expect(mealProvided('no meal')).toBe(false)
  })

  it('is false when notes say "No Meal" (case-insensitive)', () => {
    expect(mealProvided('No Meal')).toBe(false)
  })

  it('is false when notes say "no-meal" (hyphenated)', () => {
    expect(mealProvided('no-meal')).toBe(false)
  })

  it('is false when "no meal" appears mid-sentence', () => {
    expect(mealProvided('Left early, no meal taken')).toBe(false)
  })

  it('is true for irrelevant notes even with the word "meal" alone', () => {
    // "meal" without "no" prefix should NOT suppress the default
    expect(mealProvided('meal request noted')).toBe(true)
  })

  it('is false when notes say "NM" (acronym for no meal)', () => {
    expect(mealProvided('NM')).toBe(false)
  })

  it('is false when "NM" appears in combined annotation "NB/NM"', () => {
    expect(mealProvided('NB/NM')).toBe(false)
  })

  it('does NOT treat "nm" mid-word as no-meal (word boundary)', () => {
    // e.g. "tnm" should not trigger — \bNM\b requires word boundaries
    expect(mealProvided('some random tnm text')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Change 3 – Hours rounded DOWN to nearest 15-minute interval
// ---------------------------------------------------------------------------

describe('Change 3 – shiftPaidMinutes rounds down to 15-min boundary', () => {
  function shift(start: string, end: string, breakMins = 0) {
    return { start_time: start, end_time: end, break_minutes: breakMins, manual_adjustment_minutes: 0 }
  }

  it('3:09 worked → rounds DOWN to 3:00 (180 min)', () => {
    // 9:00 → 12:09 = 189 raw minutes − 0 break = 189 → floor to 180
    expect(shiftPaidMinutes(shift('09:00', '12:09'))).toBe(180)
  })

  it('9:49 worked → rounds DOWN to 9:45 (585 min)', () => {
    // 9:00 → 18:49 = 589 raw minutes → floor to 585
    expect(shiftPaidMinutes(shift('09:00', '18:49'))).toBe(585)
  })

  it('exact 15-min boundary is unchanged', () => {
    // 09:00 → 17:30 = 510 min = exactly 8h30m (34 × 15) → stays 510
    expect(shiftPaidMinutes(shift('09:00', '17:30'))).toBe(510)
  })

  it('1 extra minute is thrown away', () => {
    // 09:00 → 17:31 = 511 min → floor to 510
    expect(shiftPaidMinutes(shift('09:00', '17:31'))).toBe(510)
  })

  it('14 extra minutes are thrown away', () => {
    // 09:00 → 17:44 = 524 min → floor to 510
    expect(shiftPaidMinutes(shift('09:00', '17:44'))).toBe(510)
  })

  it('break is subtracted before rounding', () => {
    // 09:00 → 18:49 = 589 min − 30 break = 559 min → floor to 555
    expect(shiftPaidMinutes(shift('09:00', '18:49', 30))).toBe(555)
  })

  it('midnight-crossing shift still rounds correctly', () => {
    // 22:00 → 02:14 = 254 raw min → floor to 240
    expect(shiftPaidMinutes(shift('22:00', '02:14'))).toBe(240)
  })

  it('returns 0 for missing times', () => {
    expect(shiftPaidMinutes(shift('', ''))).toBe(0)
  })
})
