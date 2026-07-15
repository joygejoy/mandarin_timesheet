// Single source of truth for department-scoped write permissions. Mirrors the
// lib/roles.ts pattern: one place that decides who can write what, so every
// server action/route enforces the same rule instead of re-deriving it.
//
// Read access is intentionally NOT gated here — Dashboard/Shifts/Payroll let
// any logged-in user peek at either department (see lib/department-view.ts),
// and the Employees roster and Alcohol Sales leaderboard are always fully
// readable. Only mutations are restricted.

import type { Department } from './roles'
import type { getSupabaseAdmin } from './supabase/server'

/** A signed-in user's write scope: a single department, or 'all' for admin. */
export type UserDepartment = Department | 'all'

/** True if this user may write rows belonging to `targetDept`. */
export function canWriteDepartment(userDept: UserDepartment, targetDept: Department): boolean {
  return userDept === 'all' || userDept === targetDept
}

/**
 * Alcohol point tallies are always written by whoever manages servers_bus
 * (today: Jeff), regardless of which department's daily sheet the points are
 * attached to — bartenders (hostess_bar) generate points too, but only the
 * servers_bus manager records/adjusts them.
 */
export function canWriteAlcohol(userDept: UserDepartment): boolean {
  return userDept === 'all' || userDept === 'servers_bus'
}

/**
 * Looks up which logged-in user currently owns each department, keyed by
 * department code, for UI labels like "Jeff's current period" — pulled live
 * from the users table so reassigning a department to a new manager is just
 * an edit to that row, not a code change.
 */
export async function departmentDisplayNames(
  supabase: ReturnType<typeof getSupabaseAdmin>
): Promise<Record<Department, string>> {
  const fallback: Record<Department, string> = {
    servers_bus: 'Servers & Bus',
    hostess_bar: 'Hostess & Bar',
  }
  const { data } = await supabase
    .from('users')
    .select('department, display_name, username')
    .in('department', ['servers_bus', 'hostess_bar'])
    .eq('active', true)

  for (const row of (data ?? []) as { department: string; display_name: string | null; username: string }[]) {
    if (row.department === 'servers_bus' || row.department === 'hostess_bar') {
      fallback[row.department] = row.display_name?.trim() || row.username
    }
  }
  return fallback
}
