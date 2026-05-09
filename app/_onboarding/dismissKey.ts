/**
 * Onboarding visibility — stored client-side so it survives across pages
 * without a server cookie.
 *
 *   missing → first ever visit; show once, then mark 'closed'.
 *   'open'  → user explicitly reopened it from the sidebar.
 *   'closed'→ user has seen it (or dismissed it).
 */
export const ONBOARDING_STATE_KEY = 'mtimesheet:onboarding:state'

/** Legacy boolean flag — migrated into the state key on next mount. */
export const ONBOARDING_LEGACY_DISMISS_KEY = 'mtimesheet:onboarding:dismissed'

/** Custom event used to reopen the checklist while already on the dashboard. */
export const ONBOARDING_SHOW_EVENT = 'mtimesheet:onboarding:show'
