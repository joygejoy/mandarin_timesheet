'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV: { href: string; label: string }[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/scan', label: 'Scan sheet' },
  { href: '/shifts', label: 'Daily shifts' },
  { href: '/alcohol', label: 'Alcohol sales' },
  { href: '/payroll', label: 'Payroll' },
  { href: '/employees', label: 'Employees' },
]

export function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="hidden w-56 shrink-0 border-r border-[color:var(--border)] px-3 py-6 md:block">
      <Link
        href="/"
        className="mb-6 flex items-center gap-2 px-2 text-sm font-medium tracking-tight text-[color:var(--foreground)]"
      >
        <span className="inline-block h-2 w-2 rounded-sm bg-[color:var(--accent)]" />
        Mandarin
      </Link>
      <nav className="flex flex-col gap-0.5 text-sm">
        {NAV.map((item) => {
          const active =
            item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                'rounded-md px-2 py-1.5 transition ' +
                (active
                  ? 'bg-black/5 font-medium text-[color:var(--foreground)] dark:bg-white/10'
                  : 'text-[color:var(--muted)] hover:bg-black/5 hover:text-[color:var(--foreground)] dark:hover:bg-white/5')
              }
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
