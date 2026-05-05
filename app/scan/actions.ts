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

    const { data: created, error: createErr } = await supabase
      .from('daily_sheets')
      .insert({
        sheet_date: data.sheet_date,
        pay_period_id: period?.id ?? null,
        status: 'reviewing',
        approved_by: data.approved_by ?? null,
      })
      .select('id')
      .single()
    if (createErr) throw new Error(createErr.message)
    dailySheetId = created.id
  } else {
    reusedExistingSheet = true
  }

  // Insert all the reviewed shift rows.
  const rowsToInsert = data.rows.map((r) => ({
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
  }))

  const { error: insertErr } = await supabase.from('shifts').insert(rowsToInsert)
  if (insertErr) throw new Error(insertErr.message)

  // Archive raw OCR for audit / re-review.
  if (data.raw_ocr !== undefined) {
    await supabase.from('ocr_extractions').insert({
      daily_sheet_id: dailySheetId!,
      image_path: '(in-memory only)', // we don't persist the image yet
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
