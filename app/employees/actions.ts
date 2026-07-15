'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { ONTARIO_WAGE_PRESETS } from '@/lib/wages'
import { departmentForRole, tracksAlcoholPoints, type Department } from '@/lib/roles'
import { getSession } from '@/lib/auth'
import { canWriteDepartment } from '@/lib/permissions'

/**
 * Read access to the roster is intentionally global (everyone sees every
 * employee) — only writes are department-scoped. Throws if the signed-in
 * user may not write to `targetDept`.
 */
async function requireWriteAccess(targetDept: Department) {
  const session = await getSession()
  if (!session || session.pending) throw new Error('Not signed in.')
  if (!canWriteDepartment(session.department, targetDept)) {
    throw new Error("You don't have permission to edit this department's employees.")
  }
}

/** Admin-only: bulk operations that touch every department at once. */
async function requireAdmin() {
  const session = await getSession()
  if (!session || session.pending || session.department !== 'all') {
    throw new Error('Only an admin account can do this.')
  }
}

/** Looks up an existing employee's department and enforces write access to it. */
async function requireEmployeeWriteAccess(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  id: string
): Promise<void> {
  const { data: emp } = await supabase
    .from('employees')
    .select('department')
    .eq('id', id)
    .maybeSingle()
  await requireWriteAccess((emp?.department as Department | undefined) ?? 'servers_bus')
}

const EmployeeInput = z.object({
  full_name: z.string().trim().min(1, 'Name required').max(120),
  employee_number: z.coerce.number().int().min(1),
  role: z.string().trim().max(60).optional().or(z.literal('')),
  hourly_rate: z.coerce.number().min(0).max(999),
  age: z.coerce.number().int().min(0).max(120).optional().or(z.literal('')),
  default_break_minutes: z.coerce.number().int().min(0).max(480).default(0),
  default_meal_provided: z.preprocess((v) => v === 'on' || v === true, z.boolean()),
  active: z.preprocess((v) => v === 'on' || v === true, z.boolean()),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
})

function parse(formData: FormData) {
  const raw = Object.fromEntries(formData)
  return EmployeeInput.parse({
    ...raw,
    default_meal_provided: raw.default_meal_provided ?? false,
    active: raw.active ?? false,
  })
}

function clean(v: string | number | undefined | '') {
  if (v === '' || v === undefined) return null
  return v
}

export async function createEmployee(formData: FormData) {
  const data = parse(formData)
  const role = clean(data.role) as string | null
  await requireWriteAccess(departmentForRole(role))
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('employees').insert({
    full_name: data.full_name,
    employee_number: clean(data.employee_number),
    role,
    department: departmentForRole(role),
    tracks_alcohol_points: tracksAlcoholPoints(role),
    hourly_rate: data.hourly_rate,
    age: clean(data.age),
    default_break_minutes: data.default_break_minutes,
    default_meal_provided: data.default_meal_provided,
    active: data.active,
    notes: clean(data.notes),
  })
  if (error) throw new Error(error.message)
  revalidatePath('/employees')
  redirect('/employees')
}

export async function updateEmployee(id: string, formData: FormData) {
  const data = parse(formData)
  const role = clean(data.role) as string | null
  const supabase = getSupabaseAdmin()
  // Gate on both the employee's current department and, if the role edit
  // would move them, the destination department — a locked-in user can't
  // pull someone in from the other department or push their own out to it.
  await requireEmployeeWriteAccess(supabase, id)
  await requireWriteAccess(departmentForRole(role))
  const { error } = await supabase
    .from('employees')
    .update({
      full_name: data.full_name,
      employee_number: clean(data.employee_number),
      role,
      department: departmentForRole(role),
      tracks_alcohol_points: tracksAlcoholPoints(role),
      hourly_rate: data.hourly_rate,
      age: clean(data.age),
      default_break_minutes: data.default_break_minutes,
      default_meal_provided: data.default_meal_provided,
      active: data.active,
      notes: clean(data.notes),
    })
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/employees')
  redirect('/employees')
}

export async function toggleEmployeeActive(id: string, active: boolean) {
  const supabase = getSupabaseAdmin()
  await requireEmployeeWriteAccess(supabase, id)
  const { error } = await supabase.from('employees').update({ active }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/employees')
}

/**
 * Hard-delete an employee. Their historical shifts/alcohol sales survive
 * (employee_id is set to null but the name snapshot stays).
 */
export async function deleteEmployee(id: string) {
  const supabase = getSupabaseAdmin()
  await requireEmployeeWriteAccess(supabase, id)
  const { error } = await supabase.from('employees').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/employees')
}

/**
 * Hard-delete a batch of employees in one query. Same FK behavior as
 * deleteEmployee — historical shifts keep their snapshot.
 */
export async function deleteEmployees(ids: string[]): Promise<{ deleted: number }> {
  if (ids.length === 0) return { deleted: 0 }
  const supabase = getSupabaseAdmin()
  const { data: rows } = await supabase.from('employees').select('department').in('id', ids)
  const departments = new Set((rows ?? []).map((r) => r.department as Department))
  for (const dept of departments) await requireWriteAccess(dept)
  const { error, count } = await supabase
    .from('employees')
    .delete({ count: 'exact' })
    .in('id', ids)
  if (error) throw new Error(error.message)
  revalidatePath('/employees')
  return { deleted: count ?? ids.length }
}

/**
 * Hard-delete EVERY employee. Use with care — this clears the roster.
 * Past shifts/alcohol sales keep their name snapshots.
 */
export async function deleteAllEmployees(): Promise<{ deleted: number }> {
  await requireAdmin()
  const supabase = getSupabaseAdmin()
  // Supabase requires a filter on delete by default; use a tautology.
  const { error, count } = await supabase
    .from('employees')
    .delete({ count: 'exact' })
    .not('id', 'is', null)
  if (error) throw new Error(error.message)
  revalidatePath('/employees')
  return { deleted: count ?? 0 }
}

/**
 * Reset every employee's hourly_rate to the current Ontario minimum wage.
 * Past shifts/alcohol sales keep their snapshot rate, so historical pay
 * is unaffected — this only changes the rate going forward.
 */
export async function setAllWagesToMinimum(): Promise<{ updated: number }> {
  await requireAdmin()
  const supabase = getSupabaseAdmin()
  const { error, count } = await supabase
    .from('employees')
    .update(
      { hourly_rate: ONTARIO_WAGE_PRESETS.minimum.rate },
      { count: 'exact' }
    )
    .not('id', 'is', null)
  if (error) throw new Error(error.message)
  revalidatePath('/employees')
  return { updated: count ?? 0 }
}

/**
 * Quick-create an employee from the scan page without redirecting.
 * Returns the newly created employee row.
 */
export async function quickCreateEmployee(data: {
  full_name: string
  employee_number: number | null
  role: string | null
  hourly_rate: number
}) {
  const role = data.role?.trim() || null
  await requireWriteAccess(departmentForRole(role))
  const supabase = getSupabaseAdmin()
  const { data: emp, error } = await supabase
    .from('employees')
    .insert({
      full_name: data.full_name.trim(),
      employee_number: data.employee_number ?? null,
      role,
      department: departmentForRole(role),
      tracks_alcohol_points: tracksAlcoholPoints(role),
      hourly_rate: data.hourly_rate,
      active: true,
      default_break_minutes: 0,
      default_meal_provided: true,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  revalidatePath('/employees')
  revalidatePath('/scan')
  return emp
}

/** Inline rate update from the list. */
export async function updateEmployeeRate(id: string, hourly_rate: number) {
  if (!Number.isFinite(hourly_rate) || hourly_rate < 0 || hourly_rate > 999) {
    throw new Error('Rate must be between 0 and 999.')
  }
  const supabase = getSupabaseAdmin()
  await requireEmployeeWriteAccess(supabase, id)
  const { error } = await supabase
    .from('employees')
    .update({ hourly_rate })
    .eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/employees')
}
