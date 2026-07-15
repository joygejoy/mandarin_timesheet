'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { normalizeEmployeeName } from '@/lib/normalize'
import { departmentForRole, tracksAlcoholPoints } from '@/lib/roles'
import { getSession } from '@/lib/auth'
import { canWriteDepartment } from '@/lib/permissions'

const ImportRow = z.object({
  full_name: z.string().trim().min(1).max(120),
  employee_number: z.coerce.number().int().min(1).optional().nullable(),
  role: z.string().trim().max(60).optional().nullable(),
  hourly_rate: z.coerce.number().min(0).max(999),
  age: z.coerce.number().int().min(0).max(120).optional().nullable(),
  default_break_minutes: z.coerce.number().int().min(0).max(480).default(0),
  default_meal_provided: z.boolean().default(false),
})

export type BulkImportInput = z.input<typeof ImportRow>[]

export type BulkImportResult = {
  inserted: number
  skippedDuplicates: string[]
  errors: { name: string; message: string }[]
}

export async function bulkImportEmployees(rows: BulkImportInput): Promise<BulkImportResult> {
  const session = await getSession()
  if (!session || session.pending) throw new Error('Not signed in.')
  const supabase = getSupabaseAdmin()

  // Pull every employee (active and inactive) for normalized duplicate check.
  // We never want a re-import to create a second "Hassan" row even if the
  // prior Hassan was deactivated, and we want spelling variants like
  // "Lisa F" / "Lisa F." / "lisa  f" to all collapse together.
  // employee_number also carries a DB-level unique constraint — checked here
  // too so one colliding number is skipped instead of failing the entire
  // batch insert (Postgres allows multiple NULLs through a unique constraint,
  // so null/missing numbers are never treated as duplicates of each other).
  const { data: existing, error: fetchErr } = await supabase
    .from('employees')
    .select('full_name, employee_number')
  if (fetchErr) throw new Error(fetchErr.message)
  const existingKeys = new Set(
    (existing ?? []).map((e) => normalizeEmployeeName(e.full_name))
  )
  const existingNumbers = new Set(
    (existing ?? []).map((e) => e.employee_number).filter((n): n is number => n !== null)
  )

  const result: BulkImportResult = { inserted: 0, skippedDuplicates: [], errors: [] }
  const toInsert: Record<string, unknown>[] = []

  for (const raw of rows) {
    let parsed
    try {
      parsed = ImportRow.parse(raw)
    } catch (e) {
      result.errors.push({ name: String(raw.full_name ?? '?'), message: e instanceof Error ? e.message : 'Invalid row' })
      continue
    }
    const key = normalizeEmployeeName(parsed.full_name)
    if (!key || existingKeys.has(key)) {
      result.skippedDuplicates.push(parsed.full_name)
      continue
    }
    if (parsed.employee_number !== null && parsed.employee_number !== undefined && existingNumbers.has(parsed.employee_number)) {
      result.skippedDuplicates.push(parsed.full_name)
      continue
    }
    const rowDepartment = departmentForRole(parsed.role)
    if (!canWriteDepartment(session.department, rowDepartment)) {
      result.errors.push({
        name: parsed.full_name,
        message: "You don't have permission to import employees into this department.",
      })
      continue
    }
    existingKeys.add(key)
    if (parsed.employee_number !== null && parsed.employee_number !== undefined) {
      existingNumbers.add(parsed.employee_number)
    }
    toInsert.push({
      full_name: parsed.full_name,
      employee_number: parsed.employee_number ?? null,
      role: parsed.role || null,
      department: rowDepartment,
      tracks_alcohol_points: tracksAlcoholPoints(parsed.role),
      hourly_rate: parsed.hourly_rate,
      age: parsed.age ?? null,
      default_break_minutes: parsed.default_break_minutes,
      default_meal_provided: parsed.default_meal_provided,
      active: true,
    })
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from('employees').insert(toInsert)
    if (error) {
      result.errors.push({ name: '(batch)', message: error.message })
    } else {
      result.inserted = toInsert.length
    }
  }

  revalidatePath('/employees')
  return result
}
