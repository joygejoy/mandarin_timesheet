'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getSupabaseAdmin } from '@/lib/supabase/server'

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
 * Create (or reuse) a daily_sheet for the given date and insert all reviewed
 * shifts in one transaction-like flow. Also archives the raw OCR response.
 */
export async function approveScannedSheet(input: ApproveInputType): Promise<ApproveResult> {
  const data = ApproveInput.parse(input)
  const supabase = getSupabaseAdmin()

  // Reuse an existing sheet if one already covers this date.
  const { data: existingSheet } = await supabase
    .from('daily_sheets')
    .select('id')
    .eq('sheet_date', data.sheet_date)
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

  // Insert all the reviewed shift rows. display_order preserves the top-to-
  // bottom reading order from the scanned sheet so the daily view can render
  // rows in the same order the manager saw them in the OCR review.
  const rowsToInsert = data.rows.map((r, i) => ({
    daily_sheet_id: dailySheetId!,
    employee_id: r.employee_id,
    employee_name_snapshot: r.employee_name,
    hourly_rate_snapshot: r.hourly_rate,
    role: r.role,
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

  let { error: insertErr } = await supabase.from('shifts').insert(rowsToInsert)
  // Older databases may not have the display_order column yet (migration
  // 0002_shift_display_order.sql not applied). Retry without it so existing
  // installs keep working until the manager runs the SQL.
  if (insertErr && /display_order/i.test(insertErr.message)) {
    const fallbackRows = rowsToInsert.map((row) => {
      const copy: Record<string, unknown> = { ...row }
      delete copy.display_order
      return copy
    })
    const retry = await supabase.from('shifts').insert(fallbackRows)
    insertErr = retry.error
  }
  if (insertErr) throw new Error(insertErr.message)

  // Save alcohol points entered during the scan review step (servers only).
  if (data.alcohol_points && data.alcohol_points.length > 0) {
    await supabase.from('alcohol_sales').insert(
      data.alcohol_points.map((p) => ({
        daily_sheet_id: dailySheetId!,
        employee_id: p.employee_id,
        employee_name_snapshot: p.employee_name,
        drink_points: p.drink_points,
      }))
    ).catch(() => {})
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
