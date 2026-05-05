import Link from 'next/link'

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
    body: 'Roll approved days into a pay period and export to Sheets/CSV.',
  },
  {
    href: '/employees',
    title: 'Employees',
    body: 'Names, roles, hourly rates, default break/meal rules.',
  },
]

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl">
      <header className="pb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Scan a sheet, review extracted shifts, approve, repeat. Roll into the current pay period when ready.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="group block rounded-lg border border-zinc-200 bg-white p-5 transition hover:border-zinc-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
          >
            <h2 className="text-base font-medium group-hover:underline">{a.title}</h2>
            <p className="mt-1 text-sm text-zinc-500">{a.body}</p>
          </Link>
        ))}
      </section>
    </div>
  )
}
