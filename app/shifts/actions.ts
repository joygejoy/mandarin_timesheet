'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase/server'

const dateRe = /^\d{4}-\d{2}-\d{2}$/
const timeRe = /^\d{1,2}:\d{2}(?::\d{2})?$/

const CreateSheetInput = z.object({
  sheet_date: z.string().regex(dateRe, 'YYYY-MM-DD required'),
})

const AddShiftInput = z.object({
  daily_sheet_id: z.string().uuid(),
  employee_id: z.string().uuid().optional().nullable(),
  employee_name: z.string().trim().min(1).max(120),
  hourly_rate: z.coerce.number().min(0).max(999),
  role: z.string().trim().max(60).optional().nullable(),
  section: z.string().trim().max(20).optional().nullable(),
  start_time: z.string().regex(timeRe).optional().or(z.literal('')).nullable(),
  end_time: z.string().regex(timeRe).optional().or(z.literal('')).nullable(),
  break_minutes: z.coerce.number().int().min(0).max(480).default(0),
  meal_provided: z.preprocess((v) => v === 'on' || v === true, z.boolean()).default(false),
  notes: z.string().trim().max(500).optional().nullable(),
})

function nullify<T extends string | null | undefined>(v: T): string | null {
  if (v == null || v === '') return null
  return v
}

/** Find the pay period that encloses the given date, if any. */
async function findEnclosingPayPeriodId(date: string): Promise<string | null> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('pay_periods')
    .select('id')
    .lte('start_date', date)
    .gte('end_date', date)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data?.id ?? null
}

/** Create a new daily sheet for the given date (or return existing). Redirects to the editor. */
export async function createDailySheet(formData: FormData) {
  const data = CreateSheetInput.parse(Object.fromEntries(formData))
  const supabase = getSupabaseAdmin()

  // If one already exists for this date, jump there.
  const { data: existing } = await supabase
    .from('daily_sheets')
    .select('id')
    .eq('sheet_date', data.sheet_date)
    .maybeSingle()
  if (existing) {
    revalidatePath('/shifts')
    redirect(`/shifts/${existing.id}`)
  }

  const pay_period_id = await findEnclosingPayPeriodId(data.sheet_date)
  const { data: row, error } = await supabase
    .from('daily_sheets')
    .insert({ sheet_date: data.sheet_date, pay_period_id, status: 'draft' })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  revalidatePath('/shifts')
  redirect(`/shifts/${row.id}`)
}

export async function addShift(formData: FormData) {
  const raw = Object.fromEntries(formData)
  const parsed = AddShiftInput.parse({
    ...raw,
    employee_id: raw.employee_id || null,
    meal_provided: raw.meal_provided ?? false,
  })
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('shifts').insert({
    daily_sheet_id: parsed.daily_sheet_id,
    employee_id: parsed.employee_id ?? null,
    employee_name_snapshot: parsed.employee_name,
    hourly_rate_snapshot: parsed.hourly_rate,
    role: nullify(parsed.role),
    section: nullify(parsed.section),
    start_time: nullify(parsed.start_time),
    end_time: nullify(parsed.end_time),
    break_minutes: parsed.break_minutes,
    meal_provided: parsed.meal_provided,
    notes: nullify(parsed.notes),
    source: 'manual',
  })
  if (error) throw new Error(error.message)
  revalidatePath(`/shifts/${parsed.daily_sheet_id}`)
}

const ShiftPatch = z.object({
  employee_id: z.string().uuid().nullable().optional(),
  employee_name_snapshot: z.string().trim().min(1).max(120).optional(),
  hourly_rate_snapshot: z.coerce.number().min(0).max(999).optional(),
  role: z.string().trim().max(60).nullable().optional(),
  section: z.string().trim().max(20).nullable().optional(),
  start_time: z.string().regex(timeRe).nullable().optional(),
  end_time: z.string().regex(timeRe).nullable().optional(),
  break_minutes: z.coerce.number().int().min(0).max(480).optional(),
  meal_provided: z.boolean().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  manual_adjustment_minutes: z.coerce.number().int().min(-480).max(480).optional(),
  needs_review: z.boolean().optional(),
})

export type ShiftPatchInput = z.input<typeof ShiftPatch>

export async function updateShift(id: string, patch: ShiftPatchInput, sheetId: string) {
  const validated = ShiftPatch.parse(patch)
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('shifts').update(validated).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath(`/shifts/${sheetId}`)
}

export async function deleteShift(id: string, sheetId: string) {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('shifts').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath(`/shifts/${sheetId}`)
}

export async function setDailySheetStatus(id: string, status: 'draft' | 'reviewing' | 'approved') {
  const supabase = getSupabaseAdmin()
  const patch: Record<string, unknown> = { status }
  if (status === 'approved') {
    patch.approved_at = new Date().toISOString()
  } else {
    patch.approved_at = null
    patch.approved_by = null
  }
  const { error } = await supabase.from('daily_sheets').update(patch).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/shifts')
  revalidatePath(`/shifts/${id}`)
}

export async function deleteDailySheet(id: string) {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('daily_sheets').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/shifts')
  redirect('/shifts')
}
