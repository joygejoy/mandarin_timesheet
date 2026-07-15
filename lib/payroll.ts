import type { Shift, AlcoholSale } from '@/lib/types/db'
import { normalizeEmployeeName } from '@/lib/normalize'

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

/**
 * Paid minutes after subtracting break and applying manual adjustment,
 * rounded down to the nearest 15-minute interval. When net_minutes_override
 * is set (hostess_bar weekly sheets, whose paper total is already
 * break-adjusted), it replaces this whole computation — the bookkeeper's
 * number is used as-is rather than re-derived from start/end times.
 */
type WithOverride<T, K extends keyof Shift> = T & Partial<Pick<Shift, K>>

export function shiftPaidMinutes(
  shift: WithOverride<Pick<Shift, 'start_time' | 'end_time' | 'break_minutes' | 'manual_adjustment_minutes'>, 'net_minutes_override'>
): number {
  if (shift.net_minutes_override != null) return shift.net_minutes_override
  const gross = shiftGrossMinutes(shift)
  const after = gross - (shift.break_minutes ?? 0) + (shift.manual_adjustment_minutes ?? 0)
  const raw = Math.max(0, after)
  return Math.floor(raw / 15) * 15
}

export function shiftPaidHours(
  shift: WithOverride<Pick<Shift, 'start_time' | 'end_time' | 'break_minutes' | 'manual_adjustment_minutes'>, 'net_minutes_override'>
): number {
  return shiftPaidMinutes(shift) / 60
}

/**
 * Flat dollar amount deducted from the shift's pay when the employee took
 * a meal during the shift (typical staff-meal charge).
 */
export const MEAL_DEDUCTION = 2

/**
 * Returns the meal deduction for a single shift. meal_deduction_override
 * (hostess_bar weekly sheets — the paper sheet's own MEAL DED $ total)
 * replaces the usual $0/$MEAL_DEDUCTION boolean when set.
 */
export function shiftMealDeduction(shift: WithOverride<Pick<Shift, 'meal_provided'>, 'meal_deduction_override'>): number {
  if (shift.meal_deduction_override != null) return shift.meal_deduction_override
  return shift.meal_provided ? MEAL_DEDUCTION : 0
}

/** Gross pay before the meal deduction. */
export function shiftGrossPay(
  shift: WithOverride<
    Pick<Shift, 'start_time' | 'end_time' | 'break_minutes' | 'manual_adjustment_minutes' | 'hourly_rate_snapshot'>,
    'net_minutes_override'
  >
): number {
  return roundCurrency(shiftPaidHours(shift) * (shift.hourly_rate_snapshot ?? 0))
}

/** Net pay after the meal deduction. Floor at $0 for tiny shifts. */
export function shiftPay(
  shift: WithOverride<
    Pick<
      Shift,
      'start_time' | 'end_time' | 'break_minutes' | 'manual_adjustment_minutes' | 'hourly_rate_snapshot' | 'meal_provided'
    >,
    'net_minutes_override' | 'meal_deduction_override'
  >
): number {
  return roundCurrency(Math.max(0, shiftGrossPay(shift) - shiftMealDeduction(shift)))
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
  /** Pay BEFORE the meal deduction. */
  gross_pay: number
  /** Total meal deductions for this employee on this day ($2 per meal shift). */
  meal_deduction: number
  /** Net pay AFTER the meal deduction. */
  pay: number
  shift_count: number
  meal_count: number
}

export type DailySummary = {
  rows: DailySummaryRow[]
  total_minutes: number
  total_hours: number
  total_gross_pay: number
  total_meal_deduction: number
  total_pay: number
  shift_count: number
  meal_count: number
  exception_count: number
}

/**
 * Roll up shifts for one day, grouped by employee. Multiple shifts per
 * employee per day are summed (e.g. someone working two sections).
 */
export function summarizeDay(shifts: Shift[]): DailySummary {
  const byEmployee = new Map<string, DailySummaryRow>()
  let totalMinutes = 0
  let totalGross = 0
  let totalMealDeduction = 0
  let exceptions = 0
  let totalMealCount = 0

  for (const s of shifts) {
    if (s.needs_review) exceptions += 1
    const key = s.employee_id ?? `__name__:${s.employee_name_snapshot.toLowerCase()}`
    const minutes = shiftPaidMinutes(s)
    const gross = shiftGrossPay(s)
    const deduction = shiftMealDeduction(s)
    const net = roundCurrency(Math.max(0, gross - deduction))
    totalMinutes += minutes
    totalGross = roundCurrency(totalGross + gross)
    totalMealDeduction = roundCurrency(totalMealDeduction + deduction)
    if (s.meal_provided) totalMealCount += 1

    const existing = byEmployee.get(key)
    if (existing) {
      existing.paid_minutes += minutes
      existing.paid_hours = roundHours(existing.paid_minutes / 60)
      existing.gross_pay = roundCurrency(existing.gross_pay + gross)
      existing.meal_deduction = roundCurrency(existing.meal_deduction + deduction)
      existing.pay = roundCurrency(Math.max(0, existing.gross_pay - existing.meal_deduction))
      existing.shift_count += 1
      if (s.meal_provided) existing.meal_count += 1
    } else {
      byEmployee.set(key, {
        employee_id: s.employee_id,
        employee_name: s.employee_name_snapshot,
        hourly_rate: s.hourly_rate_snapshot,
        paid_minutes: minutes,
        paid_hours: roundHours(minutes / 60),
        gross_pay: gross,
        meal_deduction: deduction,
        pay: net,
        shift_count: 1,
        meal_count: s.meal_provided ? 1 : 0,
      })
    }
  }

  const rows = Array.from(byEmployee.values()).sort((a, b) =>
    a.employee_name.localeCompare(b.employee_name)
  )

  const totalNet = roundCurrency(Math.max(0, totalGross - totalMealDeduction))

  return {
    rows,
    total_minutes: totalMinutes,
    total_hours: roundHours(totalMinutes / 60),
    total_gross_pay: totalGross,
    total_meal_deduction: totalMealDeduction,
    total_pay: totalNet,
    shift_count: shifts.length,
    meal_count: totalMealCount,
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
  /** Pay BEFORE meal deductions. */
  gross_pay: number
  /** Total $ deducted across the period for meals taken. */
  meal_deduction: number
  /** Net pay paid out (gross_pay − meal_deduction, floored at $0). */
  net_pay: number
  shift_count: number
  meal_count: number
  alcohol_points: number
  /** Day-by-day breakdown keyed by ISO date. */
  by_date: Record<string, { minutes: number; pay: number; alcohol_points: number }>
}

export type BiweeklySummary = {
  rows: BiweeklyRow[]
  dates: string[]                    // sorted ascending
  total_hours: number
  total_gross_pay: number
  total_meal_deduction: number
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
  let totalGross = 0
  let totalMealDeduction = 0
  let totalPoints = 0

  for (const day of days) {
    dateSet.add(day.sheet_date)

    for (const s of day.shifts) {
      // A shift's own work_date wins when set (hostess/bar weekly sheets: one
      // sheet row spans 7 days, so each shift knows its actual day). Falls
      // back to the parent sheet's date for servers/bus, where it's the same
      // thing — this keeps the by-day breakdown (calendars, CSV/PDF
      // day-of-week columns) correct without changing any totals below.
      const shiftDate = s.work_date ?? day.sheet_date
      dateSet.add(shiftDate)

      const key = biweeklyKey(s.employee_name_snapshot)
      const minutes = shiftPaidMinutes(s)
      const gross = shiftGrossPay(s)
      const deduction = shiftMealDeduction(s)
      const net = roundCurrency(Math.max(0, gross - deduction))
      totalMinutes += minutes
      totalGross = roundCurrency(totalGross + gross)
      totalMealDeduction = roundCurrency(totalMealDeduction + deduction)

      const row = ensureBiweeklyRow(byEmployee, key, s)
      row.total_minutes += minutes
      row.total_hours = roundHours(row.total_minutes / 60)
      row.gross_pay = roundCurrency(row.gross_pay + gross)
      row.meal_deduction = roundCurrency(row.meal_deduction + deduction)
      row.net_pay = roundCurrency(Math.max(0, row.gross_pay - row.meal_deduction))
      row.shift_count += 1
      if (s.meal_provided) row.meal_count += 1
      row.hourly_rate = s.hourly_rate_snapshot

      const cell = (row.by_date[shiftDate] ??= { minutes: 0, pay: 0, alcohol_points: 0 })
      cell.minutes += minutes
      cell.pay = roundCurrency(cell.pay + net)
    }

    for (const a of day.alcohol_sales) {
      const key = biweeklyKey(a.employee_name_snapshot)
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

  const totalNet = roundCurrency(Math.max(0, totalGross - totalMealDeduction))

  return {
    rows: Array.from(byEmployee.values()).sort((a, b) =>
      a.employee_name.localeCompare(b.employee_name)
    ),
    dates: Array.from(dateSet).sort(),
    total_hours: roundHours(totalMinutes / 60),
    total_gross_pay: totalGross,
    total_meal_deduction: totalMealDeduction,
    total_pay: totalNet,
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
      meal_deduction: 0,
      net_pay: 0,
      shift_count: 0,
      meal_count: 0,
      alcohol_points: 0,
      by_date: {},
    }
    map.set(key, row)
  } else if (!row.employee_id && seed.employee_id) {
    row.employee_id = seed.employee_id
  }
  return row
}

/**
 * Group key for the biweekly summary. Falls back to the normalized name so
 * shifts with no employee_id (OCR rows that didn't match the roster) merge
 * with id-bearing shifts for the same person, and so spelling variants
 * ("Lisa F" / "lisa  f." / "Lísa-F") collapse into a single row.
 */
function biweeklyKey(name: string): string {
  const normalized = normalizeEmployeeName(name)
  return normalized || `__raw__:${name.trim().toLowerCase()}`
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

/**
 * Which calendar dates a sheet occupies, for building a date → sheet lookup
 * on the Dashboard/Shifts/Payroll calendars. A servers/bus sheet is just its
 * own date. A hostess/bar sheet spans the week starting on its sheet_date —
 * shown as 7 day-cells that all link to the same sheet.
 */
export function calendarDatesForSheet(sheet: { sheet_date: string; department: string }): string[] {
  if (sheet.department !== 'hostess_bar') return [sheet.sheet_date]
  return Array.from({ length: 7 }, (_, i) => addDays(sheet.sheet_date, i))
}
