'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase/server'

const ImportRow = z.object({
  full_name: z.string().trim().min(1).max(120),
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
  const supabase = getSupabaseAdmin()

  // Pull active employees once for case-insensitive duplicate check.
  const { data: existing, error: fetchErr } = await supabase
    .from('employees')
    .select('full_name')
    .eq('active', true)
  if (fetchErr) throw new Error(fetchErr.message)
  const existingLower = new Set((existing ?? []).map((e) => e.full_name.toLowerCase()))

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
    if (existingLower.has(parsed.full_name.toLowerCase())) {
      result.skippedDuplicates.push(parsed.full_name)
      continue
    }
    existingLower.add(parsed.full_name.toLowerCase())
    toInsert.push({
      full_name: parsed.full_name,
      role: parsed.role || null,
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
