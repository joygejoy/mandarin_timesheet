// Edge-runtime-safe session verification for middleware.ts.
//
// lib/auth.ts is marked 'server-only' and uses next/headers cookies(), which
// don't work in the Edge runtime middleware executes in. This file duplicates
// only the minimal JWT verification logic (same SESSION_SECRET, same cookie
// name) so middleware can check a session without importing lib/auth.ts.

import { jwtVerify } from 'jose'

export const SESSION_COOKIE_NAME = 'mt_session'

export type EdgeSessionPayload = {
  user: string
  userId: string
  pending?: boolean
  department?: 'servers_bus' | 'hostess_bar' | 'all'
}

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET is missing or too short (need at least 32 chars). ' +
        'Run `openssl rand -base64 32` and set it in your env.',
    )
  }
  return new TextEncoder().encode(secret)
}

export async function verifyEdgeSession(
  token: string | undefined
): Promise<EdgeSessionPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
    return payload as EdgeSessionPayload
  } catch {
    return null
  }
}

/**
 * Re-checks the session's user against the `active` column so a deactivated
 * user's still-valid session cookie stops working immediately instead of
 * waiting up to SESSION_DURATION_DAYS for the JWT to expire on its own. Uses
 * a direct PostgREST fetch (not the supabase-js admin client) to stay
 * Edge-runtime-safe, and fails open on network/config errors so a Supabase
 * hiccup doesn't lock everyone out of the app.
 */
export async function isSessionUserActive(userId: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return true
  try {
    const res = await fetch(
      `${url}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=active`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: 'no-store',
      }
    )
    if (!res.ok) return true
    const rows = (await res.json()) as { active: boolean }[]
    return rows.length > 0 && rows[0].active === true
  } catch {
    return true
  }
}
