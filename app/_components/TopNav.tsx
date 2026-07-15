'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LogoutButton } from './LogoutButton'
import {
  VIEW_PARAM,
  isDepartmentView,
  type DepartmentView,
} from '@/lib/department-view'
import type { Department } from '@/lib/roles'
import type { UserDepartment } from '@/lib/permissions'

function navFor(departmentView: DepartmentView) {
  return [
    { href: '/', label: 'Dashboard' },
    { href: '/scan', label: 'Scan Timesheet' },
    // Hostess/bar's unit is a week, not a day — "Daily" doesn't apply there.
    { href: '/shifts', label: departmentView === 'hostess_bar' ? 'Shifts' : 'Daily Shifts' },
    { href: '/alcohol', label: 'Alcohol Sales' },
    { href: '/payroll', label: 'Payroll' },
    { href: '/employees', label: 'Employees' },
  ]
}

// Only admin gets a department-view toggle at all — a locked-in user (Jeff,
// Fred, or anyone else scoped to a single department) always sees their own
// department, with no peek option.
function optionsFor(labels: Record<Department, string>): { value: DepartmentView; label: string }[] {
  return [
    { value: 'servers_bus', label: labels.servers_bus },
    { value: 'hostess_bar', label: labels.hostess_bar },
    { value: 'all', label: 'All' },
  ]
}

export function TopNav({
  sessionDepartment,
  departmentLabels,
}: {
  sessionDepartment: UserDepartment
  departmentLabels: Record<Department, string>
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const hidden = (pathname?.startsWith('/login') || pathname?.startsWith('/landing')) ?? false
  // Dashboard, Shifts (incl. /shifts/week) and Payroll (incl. /payroll/[id])
  // are the only sections with a peek toggle, and only admin gets one at all
  // — a locked-in user (Jeff, Fred, ...) always sees their own department.
  // /shifts/[id] is one specific sheet — its department is fixed, not a view
  // choice. Alcohol Sales and Employees are always read-open to everyone, so
  // no toggle either.
  const showDepartmentView =
    sessionDepartment === 'all' &&
    ((pathname === '/' ||
      pathname === '/shifts' ||
      pathname?.startsWith('/shifts/week') ||
      pathname?.startsWith('/payroll')) ??
      false)

  const rawView = searchParams.get(VIEW_PARAM) ?? undefined
  // Resets to the viewer's own department (or 'all' for admin) on every fresh
  // load/navigation — there's no param unless this toggle just set one. Only
  // admin's view can differ from their session department.
  const departmentView: DepartmentView =
    sessionDepartment === 'all' && isDepartmentView(rawView) ? rawView : sessionDepartment
  const options = optionsFor(departmentLabels)
  const NAV = navFor(departmentView)

  useEffect(() => { setOpen(false) }, [pathname])

  function selectDepartmentView(value: DepartmentView) {
    const params = new URLSearchParams(searchParams.toString())
    params.set(VIEW_PARAM, value)
    router.push(`${pathname}?${params.toString()}`)
    // Force a fresh server render — Next's client router cache can otherwise
    // serve the previous searchParams' RSC payload even though the URL changed.
    router.refresh()
  }

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
        <div className="flex h-13 items-center gap-3 px-5">
          <Link
            href="/"
            className="text-[15px] font-semibold tracking-tight text-white"
          >
            Mandarin
          </Link>
          {showDepartmentView && (
            <DepartmentViewSegments
              value={departmentView}
              options={options}
              onChange={selectDepartmentView}
              className="hidden md:flex"
            />
          )}
          <div className="flex-1" />
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

        {/* Department view — mobile only; desktop shows this in the header bar instead */}
        {showDepartmentView && (
          <div className="mb-3 border-b border-[color:var(--border)] px-2 pb-4 md:hidden">
            <p className="mb-2 text-xs text-[color:var(--muted)]">Viewing as</p>
            <DepartmentViewSegments
              value={departmentView}
              options={options}
              onChange={selectDepartmentView}
              full
            />
          </div>
        )}

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

/**
 * Three-way segmented control for the department view filter. Reused for the
 * desktop header bar (on the pink --accent background) and the mobile drawer
 * (on the ordinary surface background) — same shape, different tint per
 * `full` (drawer) vs. default (header) variant.
 */
function DepartmentViewSegments({
  value,
  options,
  onChange,
  className = '',
  full = false,
}: {
  value: DepartmentView
  options: { value: DepartmentView; label: string }[]
  onChange: (value: DepartmentView) => void
  className?: string
  full?: boolean
}) {
  return (
    <div
      role="group"
      aria-label="Department view"
      className={
        'inline-flex items-center gap-0.5 rounded-full p-0.5 ' +
        (full ? 'w-full bg-[color:var(--surface-container)]' : 'bg-white/10') +
        (className ? ' ' + className : '')
      }
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={
              'rounded-full px-2.5 py-1 text-xs font-medium transition ' +
              (full ? 'flex-1 text-center ' : '') +
              (full
                ? active
                  ? 'bg-[color:var(--accent-tint)] text-[color:var(--accent-strong)]'
                  : 'text-[color:var(--muted)] hover:text-[color:var(--foreground)]'
                : active
                ? 'bg-white text-[color:var(--accent-strong)]'
                : 'text-white/80 hover:text-white')
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
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
