import Link from 'next/link'
import { PageHero } from './_components/PageHero'
import { getOnboardingStatus } from './_onboarding/getOnboardingStatus'
import { GettingStarted } from './_onboarding/GettingStarted'
import { ShowWalkthroughButton } from './_onboarding/ShowWalkthroughButton'

export const dynamic = 'force-dynamic'

const QUICK_ACTIONS = [
  {
    href: '/scan',
    title: 'Scan a daily sheet',
    body: 'Upload or photograph a sign-in/out sheet. OCR extracts shifts for review.',
    eyebrow: 'Daily',
    accent: 'pink' as const,
  },
  {
    href: '/shifts',
    title: 'Enter shifts manually',
    body: 'Add a day directly without a scan.',
    eyebrow: 'Daily',
    accent: 'pink' as const,
  },
  {
    href: '/alcohol',
    title: 'Log alcohol sales',
    body: 'Daily drink points per server. Powers the biweekly leaderboard.',
    eyebrow: 'Daily',
    accent: 'green' as const,
  },
  {
    href: '/payroll',
    title: 'Biweekly payroll',
    body: 'Roll approved days into a pay period and export to Sheets, CSV, or PDF.',
    eyebrow: 'Periodic',
    accent: 'green' as const,
  },
  {
    href: '/employees',
    title: 'Employees',
    body: 'Names, roles, hourly rates, default break/meal rules.',
    eyebrow: 'Setup',
    accent: 'green' as const,
  },
]

export default async function Home() {
  const onboarding = await getOnboardingStatus()

  return (
    <div className="mx-auto max-w-3xl">
      <PageHero
        eyebrow="Mandarin · Overview"
        title="Daily payroll, made simple."
        subtitle="Scan a sheet, review extracted shifts, approve, repeat. Roll into the current pay period when ready."
        action={<ShowWalkthroughButton />}
      />

      {onboarding && <GettingStarted status={onboarding} />}

      <section aria-labelledby="quick-actions-heading" className="mb-12">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 id="quick-actions-heading" className="eyebrow-green">
            Where to next
          </h2>
          <span className="text-xs text-[color:var(--muted)] tabular-nums">
            {QUICK_ACTIONS.length} shortcuts
          </span>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {QUICK_ACTIONS.map((a) => {
            const accentColor =
              a.accent === 'green' ? 'var(--tertiary)' : 'var(--primary)'
            // Static class strings so Tailwind's scanner picks them up.
            const hoverShadow =
              a.accent === 'green'
                ? 'hover:shadow-[0_12px_32px_-12px_rgba(56,128,61,0.22)]'
                : 'hover:shadow-[0_12px_32px_-12px_rgba(236,0,140,0.18)]'
            return (
              <li key={a.href}>
                <Link
                  href={a.href}
                  className={`surface focus-ring group relative flex h-full flex-col justify-between gap-6 overflow-hidden p-5 transition-[transform,box-shadow,border-color] duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:-translate-y-0.5 hover:border-[color:var(--border-strong)] ${hoverShadow} active:scale-[0.99]`}
                >
                  <span
                    aria-hidden="true"
                    className="absolute left-0 top-5 h-6 w-0.5 origin-top scale-y-50 transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)] group-hover:scale-y-100"
                    style={{ backgroundColor: accentColor }}
                  />
                  <div>
                    <p
                      className={
                        a.accent === 'green'
                          ? 'eyebrow-green mb-2'
                          : 'eyebrow mb-2'
                      }
                    >
                      {a.eyebrow}
                    </p>
                    <h3 className="text-lg font-semibold leading-snug tracking-tight text-[color:var(--foreground)]">
                      {a.title}
                    </h3>
                    <p className="mt-1.5 text-pretty text-sm leading-relaxed text-[color:var(--muted)]">
                      {a.body}
                    </p>
                  </div>
                  <span
                    className="inline-flex items-center gap-1 text-sm font-medium transition-[gap] duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover:gap-2"
                    style={{ color: accentColor }}
                  >
                    Open
                    <span aria-hidden="true">→</span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
