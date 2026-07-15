'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { departmentForRole, type Department } from '@/lib/roles'
import { getSession } from '@/lib/auth'
import { canWriteAlcohol, canWriteDepartment } from '@/lib/permissions'

const dateRe = /^\d{4}-\d{2}-\d{2}$/
const timeRe = /^\d{1,2}:\d{2}(?::\d{2})?$/

const CreateSheetInput = z.object({
  sheet_date: z.string().regex(dateRe, 'YYYY-MM-DD required'),
  // Matches the daily_sheets department check constraint. Falls back to the
  // historical default so any pre-existing caller that omits it still works.
  department: z.enum(['servers_bus', 'hostess_bar']).default('servers_bus'),
})

/** Throws if the signed-in user isn't allowed to write to `targetDept`. */
async function requireWriteAccess(targetDept: Department) {
  const session = await getSession()
  if (!session || session.pending) throw new Error('Not signed in.')
  if (!canWriteDepartment(session.department, targetDept)) {
    throw new Error("You don't have permission to edit this department's data.")
  }
}

/** Looks up a daily sheet's department and enforces write access to it. */
async function requireSheetWriteAccess(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  sheetId: string
): Promise<void> {
  const { data: sheet } = await supabase
    .from('daily_sheets')
    .select('department')
    .eq('id', sheetId)
    .maybeSingle()
  await requireWriteAccess((sheet?.department as Department | undefined) ?? 'servers_bus')
}

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
  await requireWriteAccess(data.department)
  const supabase = getSupabaseAdmin()

  // If one already exists for this date + department, jump there. (daily_sheets
  // is keyed on (sheet_date, department) — see supabase/migrations/0002.)
  const { data: existing } = await supabase
    .from('daily_sheets')
    .select('id')
    .eq('sheet_date', data.sheet_date)
    .eq('department', data.department)
    .maybeSingle()
  if (existing) {
    revalidatePath('/shifts')
    redirect(`/shifts/${existing.id}`)
  }

  const pay_period_id = await findEnclosingPayPeriodId(data.sheet_date)
  const { data: row, error } = await supabase
    .from('daily_sheets')
    .insert({
      sheet_date: data.sheet_date,
      department: data.department,
      pay_period_id,
      status: 'draft',
    })
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

  const { data: sheetCheck } = await supabase
    .from('daily_sheets')
    .select('status, department')
    .eq('id', parsed.daily_sheet_id)
    .maybeSingle()
  if (sheetCheck?.status === 'approved') {
    throw new Error('Cannot add shifts to an approved sheet.')
  }
  await requireWriteAccess((sheetCheck?.department as Department | undefined) ?? 'servers_bus')

  // Snapshot the department the same way the OCR path does (app/scan/actions.ts):
  // prefer the linked employee's actual department, falling back to a guess
  // from the role text when there's no linked employee.
  let department: string | null = null
  if (parsed.employee_id) {
    const { data: emp } = await supabase
      .from('employees')
      .select('department')
      .eq('id', parsed.employee_id)
      .maybeSingle()
    department = (emp?.department as string | undefined) ?? departmentForRole(parsed.role)
  } else {
    department = departmentForRole(parsed.role)
  }

  const { error } = await supabase.from('shifts').insert({
    daily_sheet_id: parsed.daily_sheet_id,
    employee_id: parsed.employee_id ?? null,
    employee_name_snapshot: parsed.employee_name,
    hourly_rate_snapshot: parsed.hourly_rate,
    role: nullify(parsed.role),
    department,
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
  department: z.enum(['servers_bus', 'hostess_bar']).nullable().optional(),
  section: z.string().trim().max(20).nullable().optional(),
  start_time: z.string().regex(timeRe).nullable().optional(),
  end_time: z.string().regex(timeRe).nullable().optional(),
  break_minutes: z.coerce.number().int().min(0).max(480).optional(),
  meal_provided: z.boolean().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  manual_adjustment_minutes: z.coerce.number().int().min(-480).max(480).optional(),
  needs_review: z.boolean().optional(),
  net_minutes_override: z.coerce.number().int().min(0).max(10080).nullable().optional(),
  meal_deduction_override: z.coerce.number().min(0).max(999).nullable().optional(),
})

export type ShiftPatchInput = z.input<typeof ShiftPatch>

export async function updateShift(id: string, patch: ShiftPatchInput, sheetId: string) {
  const validated = ShiftPatch.parse(patch)
  const supabase = getSupabaseAdmin()
  await requireSheetWriteAccess(supabase, sheetId)
  const { error } = await supabase.from('shifts').update(validated).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath(`/shifts/${sheetId}`)
}

export async function deleteShift(id: string, sheetId: string) {
  const supabase = getSupabaseAdmin()
  await requireSheetWriteAccess(supabase, sheetId)
  const { error } = await supabase.from('shifts').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath(`/shifts/${sheetId}`)
}

export async function setDailySheetStatus(id: string, status: 'draft' | 'reviewing' | 'approved') {
  const supabase = getSupabaseAdmin()
  await requireSheetWriteAccess(supabase, id)
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
  await requireSheetWriteAccess(supabase, id)
  const { error } = await supabase.from('daily_sheets').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/shifts')
  redirect('/shifts')
}

// ---- Alcohol sales --------------------------------------------------------

const AlcoholInput = z.object({
  daily_sheet_id: z.string().uuid(),
  employee_id: z.string().uuid().nullable(),
  employee_name: z.string().trim().min(1).max(120),
  drink_points: z.coerce.number().int().min(0).max(9999),
  notes: z.string().trim().max(500).nullable().optional(),
})

export type AlcoholInput = z.input<typeof AlcoholInput>

/**
 * Upsert a per-day alcohol points row. Setting points=0 deletes the row.
 * Keyed on (daily_sheet_id, employee_id); for ad-hoc names with no
 * employee_id, we match by name to update in place.
 */
export async function setAlcoholPoints(input: AlcoholInput) {
  const data = AlcoholInput.parse(input)
  const session = await getSession()
  if (!session || session.pending) throw new Error('Not signed in.')
  if (!canWriteAlcohol(session.department)) {
    throw new Error("You don't have permission to edit alcohol points.")
  }
  const supabase = getSupabaseAdmin()

  if (data.drink_points === 0) {
    // Delete any existing row for this employee on this sheet.
    let q = supabase.from('alcohol_sales').delete().eq('daily_sheet_id', data.daily_sheet_id)
    if (data.employee_id) {
      q = q.eq('employee_id', data.employee_id)
    } else {
      q = q.is('employee_id', null).eq('employee_name_snapshot', data.employee_name)
    }
    const { error } = await q
    if (error) throw new Error(error.message)
    revalidatePath(`/shifts/${data.daily_sheet_id}`)
    return
  }

  if (data.employee_id) {
    const { error } = await supabase
      .from('alcohol_sales')
      .upsert(
        {
          daily_sheet_id: data.daily_sheet_id,
          employee_id: data.employee_id,
          employee_name_snapshot: data.employee_name,
          drink_points: data.drink_points,
          notes: data.notes ?? null,
        },
        { onConflict: 'daily_sheet_id,employee_id' }
      )
    if (error) throw new Error(error.message)
  } else {
    // No employee_id; check if a row already exists by name for this sheet.
    const { data: existing } = await supabase
      .from('alcohol_sales')
      .select('id')
      .eq('daily_sheet_id', data.daily_sheet_id)
      .is('employee_id', null)
      .eq('employee_name_snapshot', data.employee_name)
      .maybeSingle()
    if (existing) {
      const { error } = await supabase
        .from('alcohol_sales')
        .update({ drink_points: data.drink_points, notes: data.notes ?? null })
        .eq('id', existing.id)
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabase.from('alcohol_sales').insert({
        daily_sheet_id: data.daily_sheet_id,
        employee_id: null,
        employee_name_snapshot: data.employee_name,
        drink_points: data.drink_points,
        notes: data.notes ?? null,
      })
      if (error) throw new Error(error.message)
    }
  }
  revalidatePath(`/shifts/${data.daily_sheet_id}`)
}

export async function deleteAlcoholSale(id: string, sheetId: string) {
  const session = await getSession()
  if (!session || session.pending) throw new Error('Not signed in.')
  if (!canWriteAlcohol(session.department)) {
    throw new Error("You don't have permission to edit alcohol points.")
  }
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('alcohol_sales').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath(`/shifts/${sheetId}`)
}

export async function updateSheetDate(id: string, newDate: string): Promise<{ error?: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return { error: 'Invalid date format.' }
  const supabase = getSupabaseAdmin()
  // daily_sheets is unique on (sheet_date, department), not sheet_date alone —
  // scope the collision check to this sheet's own department so a
  // hostess_bar sheet moving dates doesn't get falsely blocked by a
  // servers_bus sheet (or vice versa) that happens to already exist on the
  // target date.
  const { data: current } = await supabase
    .from('daily_sheets')
    .select('department')
    .eq('id', id)
    .maybeSingle()
  await requireWriteAccess((current?.department as Department | undefined) ?? 'servers_bus')
  const { data: conflict } = await supabase
    .from('daily_sheets')
    .select('id')
    .eq('sheet_date', newDate)
    .eq('department', current?.department ?? 'servers_bus')
    .neq('id', id)
    .maybeSingle()
  if (conflict) return { error: `A sheet for ${newDate} already exists.` }
  const { error } = await supabase.from('daily_sheets').update({ sheet_date: newDate }).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/shifts')
  revalidatePath(`/shifts/${id}`)
  return {}
}
