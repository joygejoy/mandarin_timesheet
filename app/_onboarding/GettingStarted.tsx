'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  ONBOARDING_LEGACY_DISMISS_KEY,
  ONBOARDING_SHOW_EVENT,
  ONBOARDING_STATE_KEY,
} from './dismissKey'
import type { OnboardingStatus } from './getOnboardingStatus'

type Visibility = 'open' | 'closed'

export function GettingStarted({ status }: { status: OnboardingStatus }) {
  const [visibility, setVisibility] = useState<Visibility | null>(null)

  useEffect(() => {
    const stored = window.localStorage.getItem(ONBOARDING_STATE_KEY)
    if (stored === 'open' || stored === 'closed') {
      setVisibility(stored)
      return
    }
    // No state yet — either truly first visit, or a user with the old
    // dismissed=1 flag from before this rewrite.
    const legacy = window.localStorage.getItem(ONBOARDING_LEGACY_DISMISS_KEY)
    if (legacy === '1') {
      window.localStorage.setItem(ONBOARDING_STATE_KEY, 'closed')
      setVisibility('closed')
    } else {
      // First-ever visit: show once, then never auto-show again.
      window.localStorage.setItem(ONBOARDING_STATE_KEY, 'closed')
      setVisibility('open')
    }
  }, [])

  useEffect(() => {
    const onShow = () => {
      window.localStorage.setItem(ONBOARDING_STATE_KEY, 'open')
      setVisibility('open')
    }
    window.addEventListener(ONBOARDING_SHOW_EVENT, onShow)
    return () => window.removeEventListener(ONBOARDING_SHOW_EVENT, onShow)
  }, [])

  if (visibility !== 'open') return null

  const allDone = status.doneCount >= status.totalCount
  const nextStep = status.steps.find((s) => !s.done)

  return (
    <section className="surface mb-10 p-5">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">
          {allDone ? "You're all set" : 'Getting started'}
        </h2>
        <span className="text-xs text-[color:var(--muted)] tabular-nums">
          {status.doneCount} of {status.totalCount}
        </span>
      </header>

      <ol className="space-y-1.5">
        {status.steps.map((step) => {
          const isNext = !step.done && step === nextStep
          return (
            <li key={step.id}>
              <Link
                href={step.href}
                className="group flex items-center gap-3 rounded-md px-1.5 py-1.5 transition hover:bg-black/5 dark:hover:bg-white/5"
              >
                <Indicator done={step.done} />
                <span
                  className={
                    step.done
                      ? 'flex-1 text-sm text-[color:var(--muted)] line-through'
                      : 'flex-1 text-sm text-[color:var(--foreground)]'
                  }
                >
                  {step.title}
                </span>
                {isNext && (
                  <span className="text-xs text-[color:var(--muted)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--foreground)]">
                    Open →
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ol>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className="text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
          onClick={() => {
            window.localStorage.setItem(ONBOARDING_STATE_KEY, 'closed')
            setVisibility('closed')
          }}
        >
          Hide
        </button>
      </div>
    </section>
  )
}

function Indicator({ done }: { done: boolean }) {
  if (done) {
    return (
      <span
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[color:var(--success)] text-[10px] leading-none text-white"
        aria-hidden
      >
        ✓
      </span>
    )
  }
  return (
    <span
      className="h-4 w-4 shrink-0 rounded-full border border-[color:var(--border-strong)]"
      aria-hidden
    />
  )
}
