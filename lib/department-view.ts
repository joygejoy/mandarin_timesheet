// Client-safe department-view helpers. Deliberately has NO `server-only`
// import so the client TopNav toggle can read/write the URL search param
// directly, while server pages resolve the same value from `searchParams`.
//
// This is a READ-ONLY view filter, not a permission — see lib/permissions.ts
// for write enforcement. The view resets to the viewer's own department on
// every fresh page load/navigation because it lives in the URL, not a
// cookie: no `?view=` param means "show me my own department."
import type { Department } from './roles'
import type { UserDepartment } from './permissions'

export const VIEW_PARAM = 'view'

export type DepartmentView = Department | 'all'

export const DEPARTMENT_CODES: Department[] = ['servers_bus', 'hostess_bar']

export function isDepartmentView(value: string | string[] | undefined | null): value is DepartmentView {
  return value === 'servers_bus' || value === 'hostess_bar' || value === 'all'
}

/**
 * Resolves which department a page should render for. Only admin
 * (sessionDepartment === 'all') can peek at another department via an
 * explicit `?view=` param — a locked-in user always sees their own
 * department, regardless of any `?view=` param someone types into the URL.
 */
export function resolveDepartmentView(
  sessionDepartment: UserDepartment,
  rawParam: string | string[] | undefined
): DepartmentView {
  if (sessionDepartment !== 'all') return sessionDepartment
  return isDepartmentView(rawParam) ? rawParam : sessionDepartment
}

/**
 * Department to stamp on a newly-created record (a daily sheet, a scanned
 * sheet, etc.) while `view` is active. Unlike reads, writes are NOT governed
 * by the peek toggle — a locked-in user always creates in their own
 * department regardless of what they're currently viewing. Only an admin
 * (sessionDepartment === 'all') creates into whatever they're toggled to.
 */
export function departmentForCreate(
  sessionDepartment: UserDepartment,
  view: DepartmentView
): Department {
  if (sessionDepartment !== 'all') return sessionDepartment
  return view === 'all' ? 'servers_bus' : view
}
