'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { departmentForRole } from '@/lib/roles'
import { getSession } from '@/lib/auth'
import { canWriteDepartment } from '@/lib/permissions'

const timeRe = /^\d{1,2}:\d{2}(?::\d{2})?$/
const dateRe = /^\d{4}-\d{2}-\d{2}$/

const ReviewedShift = z.object({
  employee_id: z.string().uuid().nullable(),
  employee_name: z.string().trim().min(1).max(120),
  hourly_rate: z.coerce.number().min(0).max(999),
  section: z.string().trim().max(20).nullable(),
  role: z.string().trim().max(60).nullable(),
  start_time: z.string().regex(timeRe).nullable(),
  end_time: z.string().regex(timeRe).nullable(),
  break_minutes: z.coerce.number().int().min(0).max(480),
  meal_provided: z.boolean(),
  initials: z.string().trim().max(10).nullable(),
  notes: z.string().trim().max(500).nullable(),
  needs_review: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
})

const ApproveInput = z.object({
  sheet_date: z.string().regex(dateRe, 'Pick a date for this sheet'),
  department: z.enum(['servers_bus', 'hostess_bar']).default('servers_bus'),
  approved_by: z.string().trim().max(120).nullable().optional(),
  rows: z.array(ReviewedShift).min(1, 'Add at least one shift'),
  raw_ocr: z.unknown().optional(),
  scan_image_path: z.string().trim().max(300).nullable().optional(),
  shift_type: z.enum(['lunch', 'dinner', 'both']).nullable().optional(),
  alcohol_points: z.array(z.object({
    employee_id: z.string().uuid().nullable(),
    employee_name: z.string().trim().min(1).max(120),
    drink_points: z.coerce.number().int().min(1),
  })).optional(),
})

export type ApproveInputType = z.input<typeof ApproveInput>

export type ApproveResult = {
  daily_sheet_id: string
  inserted: number
  reused_existing_sheet: boolean
}

/**
 * Inserts fully-shaped shift rows, retrying without display_order if an
 * older database doesn't have that column yet (migration
 * 0002_shift_display_order.sql not applied). Shared by the single-day and
 * weekly-grid approve flows — both insert into `shifts` the same way.
 */
async function insertShiftRows(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  rows: Record<string, unknown>[]
): Promise<void> {
  let { error } = await supabase.from('shifts').insert(rows)
  if (error && /display_order/i.test(error.message)) {
    const fallbackRows = rows.map((row) => {
      const copy = { ...row }
      delete copy.display_order
      return copy
    })
    const retry = await supabase.from('shifts').insert(fallbackRows)
    error = retry.error
  }
  if (error) throw new Error(error.message)
}

/**
 * Create (or reuse) a daily_sheet for the given date and insert all reviewed
 * shifts in one transaction-like flow. Also archives the raw OCR response.
 */
export async function approveScannedSheet(input: ApproveInputType): Promise<ApproveResult> {
  const data = ApproveInput.parse(input)

  // Defense in depth: re-validate server-side regardless of what the client
  // sent — the Scan page hides the department picker for locked-in users,
  // but a direct call must be rejected too, not just the UI affordance.
  const session = await getSession()
  if (!session || session.pending) throw new Error('Not signed in.')
  if (!canWriteDepartment(session.department, data.department)) {
    throw new Error("You don't have permission to save sheets for this department.")
  }

  const supabase = getSupabaseAdmin()

  // Reuse an existing sheet if one already covers this date + department.
  const { data: existingSheet } = await supabase
    .from('daily_sheets')
    .select('id')
    .eq('sheet_date', data.sheet_date)
    .eq('department', data.department)
    .maybeSingle()

  let dailySheetId = existingSheet?.id ?? null
  let reusedExistingSheet = false

  if (!dailySheetId) {
    const { data: period } = await supabase
      .from('pay_periods')
      .select('id')
      .lte('start_date', data.sheet_date)
      .gte('end_date', data.sheet_date)
      .limit(1)
      .maybeSingle()

    // Try to save shift_type; gracefully degrade if the column doesn't exist yet
    // (run migration 0004_daily_sheet_shift_type.sql to enable this column).
    let sheetInsert: Record<string, unknown> = {
      sheet_date: data.sheet_date,
      department: data.department,
      pay_period_id: period?.id ?? null,
      status: 'reviewing',
      approved_by: data.approved_by ?? null,
      scan_image_path: data.scan_image_path ?? null,
      shift_type: data.shift_type ?? null,
    }
    let { data: created, error: createErr } = await supabase
      .from('daily_sheets')
      .insert(sheetInsert)
      .select('id')
      .single()
    if (createErr && /shift_type/i.test(createErr.message)) {
      const { shift_type: _st, ...withoutType } = sheetInsert
      const retry = await supabase.from('daily_sheets').insert(withoutType).select('id').single()
      if (retry.error) throw new Error(retry.error.message)
      created = retry.data
      createErr = null
    }
    if (createErr) throw new Error(createErr.message)
    dailySheetId = created!.id
  } else {
    reusedExistingSheet = true
    // Update image and shift_type on the reused sheet as needed.
    const updates: Record<string, unknown> = {}
    if (data.scan_image_path) updates.scan_image_path = data.scan_image_path
    if (data.shift_type) {
      // If a second scan of the same date has a different type, mark as 'both'.
      const { data: existing } = await supabase
        .from('daily_sheets').select('shift_type, scan_image_path').eq('id', dailySheetId!).maybeSingle()
      const curType = (existing as { shift_type?: string | null } | null)?.shift_type ?? null
      updates.shift_type = !curType || curType === data.shift_type ? data.shift_type : 'both'
      if (data.scan_image_path && (existing as { scan_image_path?: string | null } | null)?.scan_image_path) {
        delete updates.scan_image_path // existing image already set — don't overwrite
      }
    }
    if (Object.keys(updates).length > 0) {
      try { await supabase.from('daily_sheets').update(updates).eq('id', dailySheetId!) } catch { }
    }
  }

  // Look up department for matched employees so the shift snapshot reflects
  // their actual employee record, not just a guess from the role text.
  const matchedEmployeeIds = Array.from(
    new Set(data.rows.map((r) => r.employee_id).filter((id): id is string => Boolean(id)))
  )
  const employeeDeptById = new Map<string, string>()
  if (matchedEmployeeIds.length > 0) {
    const { data: matchedEmployees } = await supabase
      .from('employees')
      .select('id, department')
      .in('id', matchedEmployeeIds)
    for (const e of matchedEmployees ?? []) {
      employeeDeptById.set(e.id as string, e.department as string)
    }
  }

  // Insert all the reviewed shift rows. display_order preserves the top-to-
  // bottom reading order from the scanned sheet so the daily view can render
  // rows in the same order the manager saw them in the OCR review.
  const rowsToInsert = data.rows.map((r, i) => ({
    daily_sheet_id: dailySheetId!,
    employee_id: r.employee_id,
    employee_name_snapshot: r.employee_name,
    hourly_rate_snapshot: r.hourly_rate,
    role: r.role,
    department: (r.employee_id && employeeDeptById.get(r.employee_id)) || departmentForRole(r.role),
    section: r.section,
    start_time: r.start_time,
    end_time: r.end_time,
    break_minutes: r.break_minutes,
    meal_provided: r.meal_provided,
    initials: r.initials,
    notes: r.notes,
    needs_review: r.needs_review,
    review_flags:
      r.confidence != null && r.confidence < 0.7 ? { confidence: r.confidence } : null,
    source: 'ocr' as const,
    display_order: i,
  }))

  await insertShiftRows(supabase, rowsToInsert)

  // Save alcohol points entered during the scan review step (servers only).
  if (data.alcohol_points && data.alcohol_points.length > 0) {
    try {
      await supabase.from('alcohol_sales').insert(
        data.alcohol_points.map((p) => ({
          daily_sheet_id: dailySheetId!,
          employee_id: p.employee_id,
          employee_name_snapshot: p.employee_name,
          drink_points: p.drink_points,
        }))
      )
    } catch { }
  }

  // Archive raw OCR for audit / re-review.
  if (data.raw_ocr !== undefined) {
    await supabase.from('ocr_extractions').insert({
      daily_sheet_id: dailySheetId!,
      image_path: data.scan_image_path ?? '(no image stored)',
      model: 'gpt-4o',
      raw_response: data.raw_ocr as Record<string, unknown>,
      parsed_rows: rowsToInsert as unknown as Record<string, unknown>,
    })
  }

  revalidatePath('/shifts')
  revalidatePath(`/shifts/${dailySheetId}`)

  return {
    daily_sheet_id: dailySheetId!,
    inserted: rowsToInsert.length,
    reused_existing_sheet: reusedExistingSheet,
  }
}

// ---- Weekly grid approve (hostess/bar) -------------------------------------
//
// Unlike the daily flow above, one hostess/bar scan is a WEEK: exactly one
// daily_sheets row keyed on (week_start_date, 'hostess_bar'), same as a
// servers/bus day is exactly one row keyed on (sheet_date, 'servers_bus').
// Every existing per-sheet action (approve, delete, change date, alcohol)
// keeps working unchanged, because they already operate on one sheet id.
//
// Each row carries the week's hours/meal totals directly (net_minutes_override
// / meal_deduction_override — see lib/payroll.ts) rather than start/end
// times, because the paper sheet already has those totals computed and
// reconstructing them from day-by-day handwriting proved unreliable.

const GridReviewedShift = z.object({
  employee_id: z.string().uuid().nullable(),
  employee_name: z.string().trim().min(1).max(120),
  hourly_rate: z.coerce.number().min(0).max(999),
  net_hours: z.coerce.number().min(0).max(200),
  meal_deduction: z.coerce.number().min(0).max(999),
})

const ApproveGridInput = z.object({
  week_start_date: z.string().regex(dateRe, 'Pick the week-starting date'),
  department: z.literal('hostess_bar'),
  rows: z.array(GridReviewedShift).min(1, 'Add at least one shift'),
  raw_ocr: z.unknown().optional(),
  scan_image_path: z.string().trim().max(300).nullable().optional(),
})

export type ApproveGridInputType = z.input<typeof ApproveGridInput>

export type ApproveGridResult = {
  daily_sheet_id: string
  inserted: number
  reused_existing_sheet: boolean
}

/**
 * Create (or reuse) ONE daily_sheet for the whole week and insert every
 * flattened lunch/dinner entry as its own shift row, each stamped with its
 * own work_date. Mirrors approveScannedSheet's shape, just at week grain.
 */
export async function approveScannedGrid(input: ApproveGridInputType): Promise<ApproveGridResult> {
  const data = ApproveGridInput.parse(input)

  const session = await getSession()
  if (!session || session.pending) throw new Error('Not signed in.')
  if (!canWriteDepartment(session.department, data.department)) {
    throw new Error("You don't have permission to save sheets for this department.")
  }

  const supabase = getSupabaseAdmin()

  const { data: existingSheet } = await supabase
    .from('daily_sheets')
    .select('id, scan_image_path')
    .eq('sheet_date', data.week_start_date)
    .eq('department', data.department)
    .maybeSingle()

  let dailySheetId = existingSheet?.id ?? null
  let reusedExistingSheet = false

  if (!dailySheetId) {
    const { data: period } = await supabase
      .from('pay_periods')
      .select('id')
      .lte('start_date', data.week_start_date)
      .gte('end_date', data.week_start_date)
      .limit(1)
      .maybeSingle()

    const { data: created, error } = await supabase
      .from('daily_sheets')
      .insert({
        sheet_date: data.week_start_date,
        department: data.department,
        pay_period_id: period?.id ?? null,
        status: 'reviewing',
        scan_image_path: data.scan_image_path ?? null,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    dailySheetId = created!.id
  } else {
    reusedExistingSheet = true
    if (data.scan_image_path && !existingSheet!.scan_image_path) {
      try {
        await supabase.from('daily_sheets').update({ scan_image_path: data.scan_image_path }).eq('id', dailySheetId)
      } catch { }
    }
  }

  const matchedEmployeeIds = Array.from(
    new Set(data.rows.map((r) => r.employee_id).filter((id): id is string => Boolean(id)))
  )
  const employeeDeptById = new Map<string, string>()
  if (matchedEmployeeIds.length > 0) {
    const { data: matchedEmployees } = await supabase
      .from('employees')
      .select('id, department')
      .in('id', matchedEmployeeIds)
    for (const e of matchedEmployees ?? []) {
      employeeDeptById.set(e.id as string, e.department as string)
    }
  }

  const rowsToInsert = data.rows.map((r, i) => ({
    daily_sheet_id: dailySheetId!,
    employee_id: r.employee_id,
    employee_name_snapshot: r.employee_name,
    hourly_rate_snapshot: r.hourly_rate,
    role: null,
    department: (r.employee_id && employeeDeptById.get(r.employee_id)) || data.department,
    section: null,
    start_time: null,
    end_time: null,
    break_minutes: 0,
    meal_provided: r.meal_deduction > 0,
    initials: null,
    notes: null,
    needs_review: false,
    review_flags: null,
    source: 'ocr' as const,
    net_minutes_override: Math.round(r.net_hours * 60),
    meal_deduction_override: r.meal_deduction,
    display_order: i,
  }))

  await insertShiftRows(supabase, rowsToInsert)

  if (data.raw_ocr !== undefined) {
    await supabase.from('ocr_extractions').insert({
      daily_sheet_id: dailySheetId!,
      image_path: data.scan_image_path ?? '(no image stored)',
      model: 'gpt-4o',
      raw_response: data.raw_ocr as Record<string, unknown>,
      parsed_rows: rowsToInsert as unknown as Record<string, unknown>,
    })
  }

  revalidatePath('/shifts')
  revalidatePath(`/shifts/${dailySheetId}`)

  return {
    daily_sheet_id: dailySheetId!,
    inserted: rowsToInsert.length,
    reused_existing_sheet: reusedExistingSheet,
  }
}
