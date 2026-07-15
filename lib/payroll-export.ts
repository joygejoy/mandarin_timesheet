import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BiweeklySummary } from '@/lib/payroll'
import type { EnrichedPayrollRow } from '@/lib/pdf-render'
import { departmentForRole, getRoleDef, type Department } from '@/lib/roles'

// Human-readable label for a department value — the CSV/PDF exports are read
// by non-technical accounting staff, so the raw 'servers_bus' / 'hostess_bar'
// enum value isn't an acceptable column value. Fixed labels, independent of
// whoever currently manages each department (unlike the nav-bar toggle),
// since a historical export shouldn't read differently after a staffing
// change.
const DEPARTMENT_LABEL: Record<Department, string> = {
  servers_bus: 'Servers & Bus',
  hostess_bar: 'Hostess & Bar',
}
function departmentLabel(role: string | null): string {
  return DEPARTMENT_LABEL[departmentForRole(role)]
}

/**
 * Sort priority: servers/bartenders with hours (0), servers/bartenders no
 * hours (1), busboys with hours (2), busboys no hours (3), other with
 * hours (4), other no hours (5).
 */
function rolePriority(role: string | null, hasHours: boolean): number {
  const def = getRoleDef(role)
  if (def?.value === 'Server' || def?.value === 'Bartender') return hasHours ? 0 : 1
  if (def?.value === 'Busboy') return hasHours ? 2 : 3
  return hasHours ? 4 : 5
}

/**
 * Joins employee_number + role onto each summary row from the employees table.
 * Fetches all active employees and appends zero-hour rows for those with no
 * shifts in the period.
 * Sort order: servers with hours → servers no hours → buspersons with hours →
 * buspersons no hours → other with hours → other no hours. Alphabetical within
 * each group.
 */
export async function buildEnrichedRows(
  summary: BiweeklySummary,
  supabase: SupabaseClient
): Promise<EnrichedPayrollRow[]> {
  // Fetch all active employees to (a) enrich existing rows and (b) append zero-hour rows.
  const { data: allEmployees } = await supabase
    .from('employees')
    .select('id, full_name, employee_number, role, hourly_rate')
    .eq('active', true)

  const empMap = new Map<string, { employee_number: number | null; role: string | null; full_name: string; hourly_rate: number }>()
  for (const e of allEmployees ?? []) {
    empMap.set(e.id, { employee_number: e.employee_number, role: e.role, full_name: e.full_name, hourly_rate: e.hourly_rate })
  }

  const enriched: EnrichedPayrollRow[] = summary.rows.map((r) => {
    const emp = r.employee_id ? empMap.get(r.employee_id) : undefined
    return {
      ...r,
      employee_number: emp?.employee_number ?? null,
      department: departmentLabel(emp?.role ?? null),
    }
  })

  // Append zero-hour rows for active employees who had no shifts this period.
  const summaryIds = new Set(summary.rows.map((r) => r.employee_id).filter(Boolean))
  for (const e of allEmployees ?? []) {
    if (!summaryIds.has(e.id)) {
      enriched.push({
        employee_id: e.id,
        employee_name: e.full_name,
        hourly_rate: e.hourly_rate,
        total_minutes: 0,
        total_hours: 0,
        gross_pay: 0,
        meal_deduction: 0,
        net_pay: 0,
        shift_count: 0,
        meal_count: 0,
        alcohol_points: 0,
        by_date: {},
        employee_number: e.employee_number ?? null,
        department: departmentLabel(e.role),
      })
    }
  }

  return enriched.sort((a, b) => {
    // Priority groups tip-earners (Server, Bartender) above support roles
    // (Busboy) regardless of department, so it's role-based, not derived
    // from the employee's department directly.
    const roleA = a.employee_id ? empMap.get(a.employee_id)?.role ?? null : null
    const roleB = b.employee_id ? empMap.get(b.employee_id)?.role ?? null : null
    const pa = rolePriority(roleA, a.total_hours > 0)
    const pb = rolePriority(roleB, b.total_hours > 0)
    if (pa !== pb) return pa - pb
    return a.employee_name.localeCompare(b.employee_name)
  })
}
