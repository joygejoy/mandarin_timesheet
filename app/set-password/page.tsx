import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { SetPasswordForm } from './SetPasswordForm'

export const metadata: Metadata = {
  title: 'Set your password — Mandarin Timesheet',
}

export default async function SetPasswordPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!session.pending) redirect('/')

  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100vh-1px)] items-center justify-center px-4 py-12 md:-mx-12 md:-my-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="inline-block h-4 w-4 rounded-sm bg-[color:var(--accent)]" />
          <h1 className="text-xl font-semibold tracking-tight">Set your password</h1>
          <p className="text-sm text-[color:var(--muted)]">
            Choose a permanent password to finish setting up your account.
          </p>
        </div>
        <div className="surface p-6">
          <SetPasswordForm username={session.user} />
        </div>
      </div>
    </div>
  )
}
