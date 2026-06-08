import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BiweeklySummary } from '@/lib/payroll'
import type { EnrichedPayrollRow } from '@/lib/pdf-render'

/** Servers first (0), buspersons second (1), everything else last (2). */
function rolePriority(role: string | null): number {
  const r = (role ?? '').toLowerCase()
  if (r.includes('server')) return 0
  if (r.includes('bus')) return 1   // busboy, busperson, busser
  return 2
}

/**
 * Joins employee_number + role onto each summary row from the employees table,
 * then sorts servers → buspersons → other, alphabetically within each group.
 */
export async function buildEnrichedRows(
  summary: BiweeklySummary,
  supabase: SupabaseClient
): Promise<EnrichedPayrollRow[]> {
  const ids = summary.rows
    .map((r) => r.employee_id)
    .filter((id): id is string => id !== null)

  const empMap = new Map<string, { employee_number: number | null; role: string | null }>()

  if (ids.length > 0) {
    const { data } = await supabase
      .from('employees')
      .select('id, employee_number, role')
      .in('id', ids)
    for (const e of data ?? []) {
      empMap.set(e.id, { employee_number: e.employee_number, role: e.role })
    }
  }

  return summary.rows
    .map((r) => {
      const emp = r.employee_id ? empMap.get(r.employee_id) : undefined
      return {
        ...r,
        employee_number: emp?.employee_number ?? null,
        department: emp?.role ?? null,
      }
    })
    .sort((a, b) => {
      const pa = rolePriority(a.department)
      const pb = rolePriority(b.department)
      if (pa !== pb) return pa - pb
      return a.employee_name.localeCompare(b.employee_name)
    })
}
