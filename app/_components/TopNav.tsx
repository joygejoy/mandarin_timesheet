'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LogoutButton } from './LogoutButton'

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/scan', label: 'Scan Timesheet' },
  { href: '/shifts', label: 'Daily Shifts' },
  { href: '/alcohol', label: 'Alcohol Sales' },
  { href: '/payroll', label: 'Payroll' },
  { href: '/employees', label: 'Employees' },
]

export function TopNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const hidden = (pathname?.startsWith('/login') || pathname?.startsWith('/landing')) ?? false

  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (hidden) return null

  return (
    <>
      {/* Bar: soft pink background, pink→green gradient stripe along the bottom */}
      <header className="sticky top-0 z-30" style={{ backgroundColor: 'var(--accent)' }}>
        <div className="flex h-13 items-center px-5">
          <Link
            href="/"
            className="flex-1 text-[15px] font-semibold tracking-tight text-white"
          >
            Mandarin
          </Link>
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex h-9 w-9 items-center justify-center text-white/80 hover:text-white"
          >
            <Burger open={open} />
          </button>
        </div>
      </header>

      {/* Overlay */}
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/30"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Side drawer */}
      <nav
        className={
          'fixed right-0 top-0 z-50 flex h-full w-72 max-w-[80%] flex-col gap-0.5 bg-[color:var(--background)] px-3 py-6 shadow-xl transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)] ' +
          (open ? 'translate-x-0' : 'translate-x-full')
        }
        aria-label="Navigation menu"
        aria-hidden={!open}
      >
        {/* Drawer header */}
        <div className="mb-5 flex items-center justify-between px-2">
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: 'var(--accent)' }}
              aria-hidden
            />
            <span className="text-sm font-semibold text-[color:var(--foreground)]">
              Mandarin
            </span>
          </div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
          >
            Close
          </button>
        </div>

        {/* Nav links */}
        {NAV.map((item, i) => {
          const active =
            item.href === '/'
              ? pathname === '/'
              : pathname?.startsWith(item.href)
          // Alternate accent colors: even → pink, odd → green
          const activeColor = i % 2 === 0 ? 'var(--primary)' : 'var(--tertiary)'
          const activeTint = i % 2 === 0 ? 'var(--accent-tint)' : 'var(--success-tint)'
          return (
            <Link
              key={item.href}
              href={item.href}
              style={
                active
                  ? { backgroundColor: activeTint, color: activeColor }
                  : undefined
              }
              className={
                'rounded-md px-3 py-2.5 text-sm transition ' +
                (active
                  ? 'font-medium underline underline-offset-4'
                  : 'text-[color:var(--muted)] hover:bg-black/5 hover:text-[color:var(--foreground)] dark:hover:bg-white/5')
              }
            >
              {item.label}
            </Link>
          )
        })}

        {/* Sign out */}
        <div className="mt-auto border-t border-[color:var(--border)] pt-4">
          <LogoutButton className="w-full rounded-md px-3 py-2 text-left text-sm text-[color:var(--muted)] transition hover:bg-black/5 hover:text-[color:var(--foreground)] dark:hover:bg-white/5" />
        </div>
      </nav>
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
