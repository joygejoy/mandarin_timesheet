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

  let user
  try {
    user = await verifyCredentials(username, password)
  } catch {
    return { error: 'Server is misconfigured. Contact the admin.' }
  }

  if (!user) {
    return { error: 'Incorrect username or password.' }
  }

  if (user.must_set_password) {
    await createSession(user.username, user.id, user.department, true)
    redirect('/set-password')
  }

  await createSession(user.username, user.id, user.department, false)
  redirect('/')
}
