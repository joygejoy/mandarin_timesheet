import Link from 'next/link'
import { getOnboardingStatus } from './_onboarding/getOnboardingStatus'
import { GettingStarted } from './_onboarding/GettingStarted'
import { ShowWalkthroughButton } from './_onboarding/ShowWalkthroughButton'

export const dynamic = 'force-dynamic'

const QUICK_ACTIONS = [
  {
    href: '/scan',
    title: 'Scan a daily sheet',
    body: 'Upload or photograph a sign-in/out sheet. OCR extracts shifts for review.',
  },
  {
    href: '/shifts',
    title: 'Enter shifts manually',
    body: 'Add a day directly without a scan.',
  },
  {
    href: '/alcohol',
    title: 'Log alcohol sales',
    body: 'Daily drink points per server. Powers the biweekly leaderboard.',
  },
  {
    href: '/payroll',
    title: 'Biweekly payroll',
    body: 'Roll approved days into a pay period and export to Sheets, CSV, or PDF.',
  },
  {
    href: '/employees',
    title: 'Employees',
    body: 'Names, roles, hourly rates, default break/meal rules.',
  },
]

export default async function Home() {
  const onboarding = await getOnboardingStatus()

  return (
    <div className="mx-auto max-w-2xl">
      <header className="mb-10 rounded-xl bg-[color:var(--accent-tint)] px-5 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <ShowWalkthroughButton />
        </div>
        <p className="mt-2 text-sm text-[color:var(--muted)]">
          Scan a sheet, review extracted shifts, approve, repeat. Roll into the current pay
          period when ready.
        </p>
      </header>

      {onboarding && <GettingStarted status={onboarding} />}

      <nav className="divide-y divide-[color:var(--border)]">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="group flex items-baseline justify-between gap-4 py-4 transition hover:opacity-80"
          >
            <div>
              <h2 className="text-base font-medium group-hover:underline">{a.title}</h2>
              <p className="mt-0.5 text-sm text-[color:var(--muted)]">{a.body}</p>
            </div>
            <span className="shrink-0 text-[color:var(--muted)] transition group-hover:translate-x-0.5 group-hover:text-[color:var(--foreground)]">
              →
            </span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
