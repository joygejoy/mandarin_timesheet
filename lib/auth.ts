import 'server-only'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

const SESSION_COOKIE = 'mt_session'
const SESSION_DURATION_DAYS = 14

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

export async function createSession(user: string): Promise<void> {
  const token = await encryptSession({ user })
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

export function verifyCredentials(username: string, password: string): boolean {
  const expectedUser = process.env.APP_USERNAME
  const expectedPass = process.env.APP_PASSWORD
  if (!expectedUser || !expectedPass) {
    throw new Error('APP_USERNAME / APP_PASSWORD env vars are not configured.')
  }
  const userOk = timingSafeEqual(username, expectedUser)
  const passOk = timingSafeEqual(password, expectedPass)
  return userOk && passOk
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE
