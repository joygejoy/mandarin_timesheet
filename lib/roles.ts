// Single source of truth for role -> department / alcohol-eligibility.
// Replaces the old regex-based isBusperson()/rolePriority() checks scattered
// across AlcoholSection.tsx and payroll-export.ts.

export type Department = 'servers_bus' | 'hostess_bar'

export type RoleDef = {
  value: string
  label: string
  department: Department
  tracksAlcoholPoints: boolean
}

export const ROLE_DEFS: RoleDef[] = [
  { value: 'Server', label: 'Server', department: 'servers_bus', tracksAlcoholPoints: true },
  { value: 'Busboy', label: 'Busboy', department: 'servers_bus', tracksAlcoholPoints: false },
  { value: 'Hostess', label: 'Hostess', department: 'hostess_bar', tracksAlcoholPoints: false },
  { value: 'Bartender', label: 'Bartender', department: 'hostess_bar', tracksAlcoholPoints: true },
]

const DEFAULT_DEPARTMENT: Department = 'servers_bus'
const DEFAULT_TRACKS_ALCOHOL_POINTS = true

// Old role spellings that predate ROLE_DEFS, mapped to their current
// ROLE_DEFS value. Lets pre-existing employees.role values (e.g. rows saved
// before the 'Busboy' rename) keep resolving to the right department /
// tracksAlcoholPoints instead of silently falling back to the unrecognized-
// role defaults.
const LEGACY_ROLE_ALIASES: Record<string, string> = {
  busperson: 'Busboy',
}

/** Matches a role string against ROLE_DEFS (case-insensitive). Undefined for legacy/unrecognized roles. */
export function getRoleDef(role: string | null | undefined): RoleDef | undefined {
  if (!role) return undefined
  const needle = role.trim().toLowerCase()
  const aliased = LEGACY_ROLE_ALIASES[needle]
  if (aliased) return ROLE_DEFS.find((def) => def.value === aliased)
  return ROLE_DEFS.find((def) => def.value.toLowerCase() === needle)
}

/** Department for a role string. Defaults to servers_bus for legacy/unrecognized roles. */
export function departmentForRole(role: string | null | undefined): Department {
  return getRoleDef(role)?.department ?? DEFAULT_DEPARTMENT
}

/** Whether a role tallies alcohol/drink points. Defaults to true for legacy/unrecognized roles. */
export function tracksAlcoholPoints(role: string | null | undefined): boolean {
  return getRoleDef(role)?.tracksAlcoholPoints ?? DEFAULT_TRACKS_ALCOHOL_POINTS
}
