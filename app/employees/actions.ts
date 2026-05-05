'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase/server'

const EmployeeInput = z.object({
  full_name: z.string().trim().min(1, 'Name required').max(120),
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
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('employees').insert({
    full_name: data.full_name,
    role: clean(data.role),
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
  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('employees')
    .update({
      full_name: data.full_name,
      role: clean(data.role),
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
  const { error } = await supabase.from('employees').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/employees')
}
