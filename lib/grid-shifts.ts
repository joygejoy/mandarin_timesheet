// Pure helpers for turning a weekly-totals OCR result (lib/openai.ts,
// ExtractedGridSheet) into rows the review UI can edit and
// app/scan/actions.ts#approveScannedGrid can save. One row per employee,
// carrying the week's NET HOUR / MEAL DED totals directly — see
// lib/openai.ts for why this doesn't reconstruct day-by-day shift times.

import type { ExtractedGridSheet } from './openai'

export type FlatGridShift = {
  key: string
  employee_id: string | null
  employee_name: string
  employee_number: number | null
  net_hours: number
  meal_deduction: number
  include: boolean
}

/** One row per employee found on the sheet. Rows with nothing to report default to unchecked so they don't clutter the save. */
export function flattenGridRows(sheet: ExtractedGridSheet): FlatGridShift[] {
  return sheet.rows.map((row) => ({
    key: row.employee_name.toLowerCase(),
    employee_id: null,
    employee_name: row.employee_name,
    employee_number: row.employee_number,
    net_hours: row.net_hours,
    meal_deduction: row.meal_deduction,
    include: row.net_hours > 0 || row.meal_deduction > 0,
  }))
}
