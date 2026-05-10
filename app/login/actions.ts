'use server'

import { redirect } from 'next/navigation'
import { createSession, verifyCredentials } from '@/lib/auth'

export type LoginState = { error?: string } | undefined

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get('username') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!username || !password) {
    return { error: 'Enter both username and password.' }
  }

  let ok = false
  try {
    ok = verifyCredentials(username, password)
  } catch {
    return { error: 'Server is misconfigured. Contact the admin.' }
  }

  if (!ok) {
    return { error: 'Incorrect username or password.' }
  }

  await createSession(username)
  redirect('/')
}
