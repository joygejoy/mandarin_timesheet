import type { Metadata } from 'next'
import { LoginForm } from './LoginForm'

export const metadata: Metadata = {
  title: 'Sign in — Mandarin Timesheet',
}

export default function LoginPage() {
  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100vh-1px)] items-center justify-center px-4 py-12 md:-mx-12 md:-my-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="inline-block h-4 w-4 rounded-sm bg-[color:var(--accent)]" />
          <h1 className="text-xl font-semibold tracking-tight">Mandarin Timesheet</h1>
          <p className="text-sm text-[color:var(--muted)]">Sign in to continue.</p>
        </div>
        <div className="surface p-6">
          <LoginForm />
        </div>
      </div>
    </div>
  )
}
