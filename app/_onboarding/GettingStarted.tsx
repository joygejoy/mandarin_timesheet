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
  const progressPct = Math.round((status.doneCount / status.totalCount) * 100)

  return (
    <section className="surface mb-12 overflow-hidden p-6">
      {/* Tinted progress strip across the top */}
      <div
        className="-mx-6 -mt-6 mb-6 h-1 bg-[color:var(--border)]"
        aria-hidden="true"
      >
        <div
          className="h-full bg-gradient-to-r from-[color:var(--primary)] to-[color:var(--tertiary)] transition-[width] duration-500 ease-[cubic-bezier(0.2,0,0,1)]"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <header className="mb-5 flex items-baseline justify-between gap-3">
        <div>
          <p className="eyebrow mb-1.5">
            {allDone ? 'Setup complete' : 'Getting started'}
          </p>
          <h2 className="text-xl font-semibold leading-tight tracking-tight">
            {allDone
              ? "You're all set."
              : nextStep
              ? <>Next: <span className="text-[color:var(--primary)]">{nextStep.title.toLowerCase()}</span></>
              : 'Six steps to your first payroll.'}
          </h2>
        </div>
        <span
          className="shrink-0 text-xs text-[color:var(--muted)] tabular-nums"
          aria-label={`${status.doneCount} of ${status.totalCount} steps complete`}
        >
          <span className="font-medium text-[color:var(--foreground)]">
            {status.doneCount}
          </span>
          {' / '}
          {status.totalCount}
        </span>
      </header>

      <ol className="space-y-1">
        {status.steps.map((step, i) => {
          const isNext = !step.done && step === nextStep
          return (
            <li key={step.id}>
              <Link
                href={step.href}
                className="focus-ring group -mx-2 flex items-center gap-4 rounded-xl px-2 py-2.5 transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-[color:var(--primary)]/5 active:scale-[0.99]"
              >
                <span
                  className="text-xs font-medium tabular-nums text-[color:var(--muted)]"
                  aria-hidden="true"
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <Indicator done={step.done} active={isNext} />
                <span
                  className={
                    step.done
                      ? 'flex-1 text-sm text-[color:var(--muted)] line-through decoration-[color:var(--border-strong)]'
                      : isNext
                      ? 'flex-1 text-sm font-medium text-[color:var(--foreground)]'
                      : 'flex-1 text-sm text-[color:var(--foreground)]'
                  }
                >
                  {step.title}
                </span>
                {isNext && (
                  <span
                    className="text-xs font-medium text-[color:var(--primary)] opacity-0 transition-opacity duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover:opacity-100"
                    aria-hidden="true"
                  >
                    Open →
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ol>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => {
            window.localStorage.setItem(ONBOARDING_STATE_KEY, 'closed')
            setVisibility('closed')
          }}
        >
          Hide for now
        </button>
      </div>
    </section>
  )
}

function Indicator({ done, active }: { done: boolean; active: boolean }) {
  if (done) {
    return (
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--tertiary)] text-[11px] font-bold leading-none text-[color:var(--on-tertiary)] shadow-[0_2px_6px_-1px_rgba(56,128,61,0.4)]"
        aria-hidden="true"
      >
        ✓
      </span>
    )
  }
  return (
    <span
      className={
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-200 ease-[cubic-bezier(0.2,0,0,1)] ' +
        (active
          ? 'border-[color:var(--primary)] bg-[color:var(--primary)]/10'
          : 'border-[color:var(--border-strong)] bg-transparent')
      }
      aria-hidden="true"
    >
      {active && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-[color:var(--primary)]"
        />
      )}
    </span>
  )
}
