import type { Shift, AlcoholSale } from '@/lib/types/db'

/** Parse a "HH:MM" or "HH:MM:SS" string into minutes since midnight. */
function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t.trim())
  if (!m) return null
  const h = Number(m[1])
  const mm = Number(m[2])
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null
  return h * 60 + mm
}

/**
 * Gross minutes worked for one shift, before break/adjustment deductions.
 * Crosses midnight if end_time < start_time (assumes <24h shifts).
 * Returns 0 when start or end is missing/invalid.
 */
export function shiftGrossMinutes(shift: Pick<Shift, 'start_time' | 'end_time'>): number {
  const s = timeToMinutes(shift.start_time)
  const e = timeToMinutes(shift.end_time)
  if (s == null || e == null) return 0
  let diff = e - s
  if (diff < 0) diff += 24 * 60
  return diff
}

/** Paid minutes after subtracting break and applying manual adjustment. */
export function shiftPaidMinutes(
  shift: Pick<Shift, 'start_time' | 'end_time' | 'break_minutes' | 'manual_adjustment_minutes'>
): number {
  const gross = shiftGrossMinutes(shift)
  const after = gross - (shift.break_minutes ?? 0) + (shift.manual_adjustment_minutes ?? 0)
  return Math.max(0, after)
}

export function shiftPaidHours(
  shift: Pick<Shift, 'start_time' | 'end_time' | 'break_minutes' | 'manual_adjustment_minutes'>
): number {
  return shiftPaidMinutes(shift) / 60
}

export function shiftPay(
  shift: Pick<Shift, 'start_time' | 'end_time' | 'break_minutes' | 'manual_adjustment_minutes' | 'hourly_rate_snapshot'>
): number {
  return roundCurrency(shiftPaidHours(shift) * (shift.hourly_rate_snapshot ?? 0))
}

export function roundCurrency(n: number): number {
  return Math.round(n * 100) / 100
}

export function roundHours(n: number): number {
  return Math.round(n * 100) / 100
}

/** Format minutes as "Hh Mm" (e.g. 425 → "7h 05m"). */
export function formatMinutes(min: number): string {
  if (!Number.isFinite(min) || min <= 0) return '0h 00m'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return `${h}h ${m.toString().padStart(2, '0')}m`
}

// ---- Daily summary --------------------------------------------------------

export type DailySummaryRow = {
  employee_id: string | null
  employee_name: string
  hourly_rate: number
  paid_minutes: number
  paid_hours: number
  pay: number
  shift_count: number
}

export type DailySummary = {
  rows: DailySummaryRow[]
  total_minutes: number
  total_hours: number
  total_pay: number
  shift_count: number
  exception_count: number
}

/**
 * Roll up shifts for one day, grouped by employee. Multiple shifts per
 * employee per day are summed (e.g. someone working two sections).
 */
export function summarizeDay(shifts: Shift[]): DailySummary {
  const byEmployee = new Map<string, DailySummaryRow>()
  let totalMinutes = 0
  let totalPay = 0
  let exceptions = 0

  for (const s of shifts) {
    if (s.needs_review) exceptions += 1
    const key = s.employee_id ?? `__name__:${s.employee_name_snapshot.toLowerCase()}`
    const minutes = shiftPaidMinutes(s)
    const pay = roundCurrency((minutes / 60) * s.hourly_rate_snapshot)
    totalMinutes += minutes
    totalPay = roundCurrency(totalPay + pay)

    const existing = byEmployee.get(key)
    if (existing) {
      existing.paid_minutes += minutes
      existing.paid_hours = roundHours(existing.paid_minutes / 60)
      existing.pay = roundCurrency(existing.pay + pay)
      existing.shift_count += 1
    } else {
      byEmployee.set(key, {
        employee_id: s.employee_id,
        employee_name: s.employee_name_snapshot,
        hourly_rate: s.hourly_rate_snapshot,
        paid_minutes: minutes,
        paid_hours: roundHours(minutes / 60),
        pay,
        shift_count: 1,
      })
    }
  }

  const rows = Array.from(byEmployee.values()).sort((a, b) =>
    a.employee_name.localeCompare(b.employee_name)
  )

  return {
    rows,
    total_minutes: totalMinutes,
    total_hours: roundHours(totalMinutes / 60),
    total_pay: totalPay,
    shift_count: shifts.length,
    exception_count: exceptions,
  }
}

// ---- Biweekly summary -----------------------------------------------------

export type BiweeklyRow = {
  employee_id: string | null
  employee_name: string
  hourly_rate: number       // most recent rate seen
  total_minutes: number
  total_hours: number
  gross_pay: number
  shift_count: number
  alcohol_points: number
  /** Day-by-day breakdown keyed by ISO date. */
  by_date: Record<string, { minutes: number; pay: number; alcohol_points: number }>
}

export type BiweeklySummary = {
  rows: BiweeklyRow[]
  dates: string[]                    // sorted ascending
  total_hours: number
  total_pay: number
  total_alcohol_points: number
}

type DaySheetWithChildren = {
  sheet_date: string
  shifts: Shift[]
  alcohol_sales: AlcoholSale[]
}

export function summarizePayPeriod(days: DaySheetWithChildren[]): BiweeklySummary {
  const byEmployee = new Map<string, BiweeklyRow>()
  const dateSet = new Set<string>()
  let totalMinutes = 0
  let totalPay = 0
  let totalPoints = 0

  for (const day of days) {
    dateSet.add(day.sheet_date)

    for (const s of day.shifts) {
      const key = s.employee_id ?? `__name__:${s.employee_name_snapshot.toLowerCase()}`
      const minutes = shiftPaidMinutes(s)
      const pay = roundCurrency((minutes / 60) * s.hourly_rate_snapshot)
      totalMinutes += minutes
      totalPay = roundCurrency(totalPay + pay)

      const row = ensureBiweeklyRow(byEmployee, key, s)
      row.total_minutes += minutes
      row.total_hours = roundHours(row.total_minutes / 60)
      row.gross_pay = roundCurrency(row.gross_pay + pay)
      row.shift_count += 1
      row.hourly_rate = s.hourly_rate_snapshot

      const cell = (row.by_date[day.sheet_date] ??= { minutes: 0, pay: 0, alcohol_points: 0 })
      cell.minutes += minutes
      cell.pay = roundCurrency(cell.pay + pay)
    }

    for (const a of day.alcohol_sales) {
      const key = a.employee_id ?? `__name__:${a.employee_name_snapshot.toLowerCase()}`
      totalPoints += a.drink_points

      const row = ensureBiweeklyRow(byEmployee, key, {
        employee_id: a.employee_id,
        employee_name_snapshot: a.employee_name_snapshot,
        hourly_rate_snapshot: 0,
      })
      row.alcohol_points += a.drink_points

      const cell = (row.by_date[day.sheet_date] ??= { minutes: 0, pay: 0, alcohol_points: 0 })
      cell.alcohol_points += a.drink_points
    }
  }

  return {
    rows: Array.from(byEmployee.values()).sort((a, b) =>
      a.employee_name.localeCompare(b.employee_name)
    ),
    dates: Array.from(dateSet).sort(),
    total_hours: roundHours(totalMinutes / 60),
    total_pay: totalPay,
    total_alcohol_points: totalPoints,
  }
}

function ensureBiweeklyRow(
  map: Map<string, BiweeklyRow>,
  key: string,
  seed: Pick<Shift, 'employee_id' | 'employee_name_snapshot' | 'hourly_rate_snapshot'>
): BiweeklyRow {
  let row = map.get(key)
  if (!row) {
    row = {
      employee_id: seed.employee_id,
      employee_name: seed.employee_name_snapshot,
      hourly_rate: seed.hourly_rate_snapshot,
      total_minutes: 0,
      total_hours: 0,
      gross_pay: 0,
      shift_count: 0,
      alcohol_points: 0,
      by_date: {},
    }
    map.set(key, row)
  }
  return row
}

// ---- Pay period date helpers ----------------------------------------------

/** ISO date (YYYY-MM-DD) string, no timezone shift. */
export function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return isoDate(d)
}

/** Suggest start/end for the next biweekly period after the given last end. */
export function suggestNextPeriod(lastEnd: string | null): { start: string; end: string } {
  const start = lastEnd ? addDays(lastEnd, 1) : isoDate(new Date())
  return { start, end: addDays(start, 13) } // 14 days inclusive
}

export function daysInRange(startIso: string, endIso: string): string[] {
  const out: string[] = []
  let cursor = startIso
  while (cursor <= endIso) {
    out.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return out
}
