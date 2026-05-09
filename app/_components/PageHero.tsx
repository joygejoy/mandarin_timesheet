import Link from 'next/link'
import type { ReactNode } from 'react'

type Accent = 'pink' | 'green'

type PageHeroProps = {
  eyebrow: string
  title: ReactNode
  subtitle?: ReactNode
  /** Visual accent for the eyebrow + atmosphere. Pink for daily/scan/payroll
      pages; green for setup/leaderboard/period pages. Both colors always
      appear in the atmosphere so the page reads as co-branded. */
  accent?: Accent
  /** Right-aligned action(s) — typically a button or a button cluster. */
  action?: ReactNode
  /** Tiny "← back" link rendered above the eyebrow. */
  backLink?: { href: string; label: string }
}

export function PageHero({
  eyebrow,
  title,
  subtitle,
  accent = 'pink',
  action,
  backLink,
}: PageHeroProps) {
  return (
    <div className="relative">
      <Atmosphere accent={accent} />
      <div className="relative">
        {backLink && (
          <Link
            href={backLink.href}
            className="focus-ring -ml-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm text-[color:var(--muted)] transition-colors duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:text-[color:var(--foreground)]"
          >
            <span aria-hidden="true">←</span>
            {backLink.label}
          </Link>
        )}
        <header className={backLink ? 'mt-3 pb-8' : 'pt-2 pb-8'}>
          <p
            className={
              (accent === 'green' ? 'eyebrow-green ' : 'eyebrow ') +
              'flex items-center gap-2'
            }
          >
            <span
              aria-hidden="true"
              className={
                'inline-block h-1.5 w-1.5 rounded-full ' +
                (accent === 'green'
                  ? 'bg-[color:var(--tertiary)]'
                  : 'bg-[color:var(--primary)]')
              }
            />
            {eyebrow}
          </p>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
            <h1 className="text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.01em] text-[color:var(--foreground)] sm:text-4xl">
              {title}
            </h1>
            {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
          </div>
          {subtitle && (
            <p className="mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-[color:var(--muted)] sm:text-base">
              {subtitle}
            </p>
          )}
        </header>
      </div>
    </div>
  )
}

function Atmosphere({ accent }: { accent: Accent }) {
  // Two organic blur shapes anchored at corners. The dominant color follows
  // `accent`; the other color always appears at lower opacity so every page
  // carries both pink + green from Mandarin's brand palette.
  const dominant = accent === 'green' ? 'var(--tertiary)' : 'var(--primary)'
  const secondary = accent === 'green' ? 'var(--primary)' : 'var(--tertiary)'
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[380px] overflow-hidden"
    >
      <div
        className="blur-shape -top-24 -right-24 h-72 w-72"
        style={{ backgroundColor: dominant, opacity: 0.18 }}
      />
      <div
        className="blur-shape -bottom-24 -left-28 h-64 w-64"
        style={{ backgroundColor: secondary, opacity: 0.13 }}
      />
    </div>
  )
}
