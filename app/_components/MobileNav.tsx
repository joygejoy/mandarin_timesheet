'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const NAV: { href: string; label: string }[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/scan', label: 'Scan sheet' },
  { href: '/shifts', label: 'Daily shifts' },
  { href: '/alcohol', label: 'Alcohol sales' },
  { href: '/payroll', label: 'Payroll' },
  { href: '/employees', label: 'Employees' },
]

export function MobileNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b-2 border-[color:var(--accent)] bg-[color:var(--background)]/90 px-4 py-3 backdrop-blur md:hidden">
        <Link
          href="/"
          className="flex items-center gap-2 text-base font-semibold tracking-tight text-[color:var(--foreground)]"
        >
          <span className="inline-block h-3 w-3 rounded-sm bg-[color:var(--accent)]" />
          Mandarin
        </Link>
        <button
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="-mr-2 flex h-9 w-9 items-center justify-center rounded-md text-[color:var(--muted)] hover:bg-black/5 hover:text-[color:var(--foreground)] dark:hover:bg-white/5"
        >
          <Burger open={open} />
        </button>
      </header>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
            onClick={() => setOpen(false)}
          />
          <nav
            className="fixed right-0 top-0 z-50 flex h-full w-72 max-w-[80%] flex-col gap-1 border-l border-[color:var(--border)] bg-[color:var(--background)] px-3 py-6 shadow-lg md:hidden"
          >
            <div className="mb-3 flex items-center justify-between px-2">
              <span className="text-sm font-medium">Menu</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
              >
                Close
              </button>
            </div>
            {NAV.map((item) => {
              const active =
                item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={
                    'rounded-md border-l-2 px-3 py-2 text-sm transition ' +
                    (active
                      ? 'border-[color:var(--accent)] bg-[color:var(--accent-tint)] font-medium text-[color:var(--foreground)]'
                      : 'border-transparent text-[color:var(--muted)] hover:bg-black/5 hover:text-[color:var(--foreground)] dark:hover:bg-white/5')
                  }
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </>
      )}
    </>
  )
}

function Burger({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      {open ? (
        <>
          <path d="M5 5 L15 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M15 5 L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M4 6h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M4 14h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}
