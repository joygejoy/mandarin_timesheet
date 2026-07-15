'use client'

import { useActionState } from 'react'
import { setPasswordAction, type SetPasswordState } from './actions'

const initialState: SetPasswordState = undefined

export function SetPasswordForm({ username }: { username: string }) {
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(
    setPasswordAction,
    initialState
  )

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-[color:var(--foreground)]">Username</span>
        <input type="text" value={username} readOnly disabled className="input" />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-[color:var(--foreground)]">New password</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          autoFocus
          className="input"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-[color:var(--foreground)]">Confirm new password</span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={8}
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
        {pending ? 'Saving…' : 'Set password'}
      </button>
    </form>
  )
}
