import 'server-only'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { randomBytes, scrypt, timingSafeEqual as cryptoTimingSafeEqual } from 'crypto'
import { promisify } from 'util'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import type { User } from '@/lib/types/db'

const SESSION_COOKIE = 'mt_session'
const SESSION_DURATION_DAYS = 14

const scryptAsync = promisify(scrypt)
const SCRYPT_KEYLEN = 64

// Fixed, non-secret "salt:hash" pair in the same format hashPassword produces
// (16-byte salt hex, 64-byte hash hex). Used only to burn the same scrypt
// cost on the no-such-user/inactive-user path as a real password check, so
// response timing can't be used to enumerate usernames.
const DUMMY_STORED_HASH = `${'a'.repeat(32)}:${'b'.repeat(128)}`

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

export type SessionPayload = JWTPayload & {
  user: string
  userId: string
  /** true = authenticated but must set a real password before using the app. */
  pending?: boolean
  /**
   * The user's write scope, signed into the JWT at login so every server
   * action/route can enforce lib/permissions.ts checks without a DB round
   * trip and without trusting a client-editable cookie. 'all' = admin.
   */
  department: User['department']
}

export async function encryptSession(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_DAYS}d`)
    .sign(getSecret())
}

export async function decryptSession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
    return payload as SessionPayload
  } catch {
    return null
  }
}

export async function createSession(
  user: string,
  userId: string,
  department: User['department'],
  pending: boolean = false
): Promise<void> {
  const token = await encryptSession({ user, userId, department, pending })
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DURATION_DAYS * 24 * 60 * 60,
  })
}

export async function destroySession(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  return decryptSession(token)
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still walk to keep length-leak minimal; result is forced to false.
    let diff = 1
    const len = Math.max(a.length, b.length)
    for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
    return false
  }
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Hashes a password with scrypt + a random salt. Stored as "salt:hash" hex. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer
  return `${salt}:${derived.toString('hex')}`
}

/** Verifies a password against a "salt:hash" string using a timing-safe comparison. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hashHex] = stored.split(':')
  if (!salt || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const derived = (await scryptAsync(password, salt, expected.length)) as Buffer
  if (derived.length !== expected.length) return false
  return cryptoTimingSafeEqual(derived, expected)
}

/**
 * Looks up a user by username (case-insensitive) and verifies their
 * password. Returns the matched user row (so callers can read id /
 * must_set_password / department), or null if the credentials
 * don't match an active user.
 */
export async function verifyCredentials(username: string, password: string): Promise<User | null> {
  const supabase = getSupabaseAdmin()
  // ilike is pattern matching under the hood — escape LIKE wildcard chars so
  // a username containing "%" or "_" can't widen the match.
  const escapedUsername = username.replace(/[%_\\]/g, (m) => `\\${m}`)
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .ilike('username', escapedUsername)
    .eq('active', true)
    .maybeSingle()
  if (!user || !(user as User).active) {
    // Perform a dummy scrypt derivation so this path costs about as much
    // time as the real one below — otherwise an unknown/inactive username
    // returns near-instantly while a valid active one always pays the full
    // scrypt cost, leaking username existence via response timing.
    await verifyPassword(password, DUMMY_STORED_HASH)
    return null
  }
  const row = user as User
  const ok = await verifyPassword(password, row.password_hash)
  if (!ok) return null
  return row
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE
