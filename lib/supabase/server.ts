import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}

/**
 * Admin client — uses the service role key, bypasses RLS.
 * Server-only. Use for all server actions and server-rendered pages
 * until we add per-user auth.
 */
export function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new SupabaseNotConfiguredError()
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * Cookie-aware SSR client. Use once we add user auth.
 * Today this is unused; kept so the swap is one import away later.
 */
export async function getSupabaseServer() {
  if (!isSupabaseConfigured()) throw new SupabaseNotConfiguredError()
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }: { name: string; value: string; options: CookieOptions }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — set in middleware/route handler instead.
          }
        },
      },
    }
  )
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      'Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY to .env.local.'
    )
    this.name = 'SupabaseNotConfiguredError'
  }
}
