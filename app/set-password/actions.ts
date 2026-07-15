'use server'

import { redirect } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { createSession, getSession, hashPassword } from '@/lib/auth'
import type { User } from '@/lib/types/db'

export type SetPasswordState = { error?: string } | undefined

export async function setPasswordAction(
  _prev: SetPasswordState,
  formData: FormData
): Promise<SetPasswordState> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!session.pending) redirect('/')

  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm') ?? '')

  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' }
  }
  if (password !== confirm) {
    return { error: "Passwords don't match." }
  }

  const supabase = getSupabaseAdmin()
  const password_hash = await hashPassword(password)
  const { data: updated, error } = await supabase
    .from('users')
    .update({ password_hash, must_set_password: false })
    .eq('id', session.userId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  const user = updated as User
  await createSession(user.username, user.id, user.department, false)
  redirect('/')
}
