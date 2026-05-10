'use client'

import { useActionState } from 'react'
import { loginAction, type LoginState } from './actions'

const initialState: LoginState = undefined

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, initialState)

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-[color:var(--foreground)]">Username</span>
        <input
          name="username"
          type="text"
          autoComplete="username"
          autoFocus
          required
          className="input"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-[color:var(--foreground)]">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
        />
      </label>

      {state?.error && (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--accent)]/40 bg-[color:var(--accent-tint)] px-3 py-2 text-sm text-[color:var(--accent-strong)]"
        >
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn-primary mt-2 disabled:opacity-60">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
