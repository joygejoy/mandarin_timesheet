'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { DailySheet } from '@/lib/types/db'

export type SheetRow = {
  id: string
  sheet_date: string
  status: DailySheet['status']
  pay_period_id: string | null
  shift_count: number
  total_hours: number
  total_pay: number
}

type SortDir = 'desc' | 'asc'

export function SheetsClient({ sheets }: { sheets: SheetRow[] }) {
  const [dateFilter, setDateFilter] = useState('')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const visible = useMemo(() => {
    let rows = sheets
    if (dateFilter) {
      // Substring match so partial dates work ("2026-05" finds the whole month).
      rows = rows.filter((s) => s.sheet_date.includes(dateFilter))
    }
    rows = [...rows].sort((a, b) =>
      sortDir === 'desc'
        ? b.sheet_date.localeCompare(a.sheet_date)
        : a.sheet_date.localeCompare(b.sheet_date)
    )
    return rows
  }, [sheets, dateFilter, sortDir])

  return (
    <div className="space-y-3">
      <Toolbar
        dateFilter={dateFilter}
        setDateFilter={setDateFilter}
        sortDir={sortDir}
        setSortDir={setSortDir}
        visibleCount={visible.length}
        totalCount={sheets.length}
      />

      {visible.length === 0 ? (
        <p className="surface border-dashed p-6 text-center text-sm text-[color:var(--muted)]">
          {dateFilter
            ? `No sheets match "${dateFilter}".`
            : 'No daily sheets yet — open today\'s above.'}
        </p>
      ) : (
        <SheetTable rows={visible} />
      )}
    </div>
  )
}

function Toolbar({
  dateFilter,
  setDateFilter,
  sortDir,
  setSortDir,
  visibleCount,
  totalCount,
}: {
  dateFilter: string
  setDateFilter: (s: string) => void
  sortDir: SortDir
  setSortDir: (d: SortDir) => void
  visibleCount: number
  totalCount: number
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-[color:var(--muted)]">
          Filter by date
        </span>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="input"
            aria-label="Filter sheets by date"
          />
          {dateFilter && (
            <button
              type="button"
              onClick={() => setDateFilter('')}
              className="btn-ghost text-xs"
              aria-label="Clear date filter"
            >
              Clear
            </button>
          )}
        </div>
      </label>

      <label className="block text-sm">
        <span className="mb-1 block text-xs text-[color:var(--muted)]">Sort</span>
        <select
          value={sortDir}
          onChange={(e) => setSortDir(e.target.value as SortDir)}
          className="input"
          aria-label="Sort order"
        >
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
        </select>
      </label>

      <p className="ml-auto pb-1.5 text-xs text-[color:var(--muted)]">
        Showing <span className="font-medium text-[color:var(--foreground)]">{visibleCount}</span>
        {visibleCount !== totalCount && <> of {totalCount}</>}
      </p>
    </div>
  )
}

function SheetTable({ rows }: { rows: SheetRow[] }) {
  return (
    <div className="surface overflow-hidden">
      <table className="min-w-full text-sm">
        <thead className="border-b border-[color:var(--border)] text-left text-xs font-normal text-[color:var(--muted)]">
          <tr>
            <th className="px-3 py-2.5 font-normal">Date</th>
            <th className="px-3 py-2.5 font-normal">Status</th>
            <th className="px-3 py-2.5 font-normal text-right">Shifts</th>
            <th className="px-3 py-2.5 font-normal text-right">Hours</th>
            <th className="px-3 py-2.5 font-normal text-right">Pay</th>
            <th className="px-3 py-2.5 text-right" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--border)]">
          {rows.map((s) => (
            <tr key={s.id}>
              <td className="px-3 py-2.5 font-medium">
                <Link href={`/shifts/${s.id}`} className="link-soft">
                  {fmtDateLong(s.sheet_date)}
                </Link>
                {!s.pay_period_id && (
                  <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
                    no pay period
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5">
                <StatusDot status={s.status} />
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{s.shift_count}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{s.total_hours.toFixed(2)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">${s.total_pay.toFixed(2)}</td>
              <td className="px-3 py-2.5 text-right">
                <Link href={`/shifts/${s.id}`} className="btn-secondary text-xs">
                  Open →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatusDot({ status }: { status: DailySheet['status'] }) {
  const color =
    status === 'approved'
      ? 'bg-[color:var(--success)]'
      : status === 'reviewing'
      ? 'bg-[color:var(--accent)]'
      : 'bg-zinc-400 dark:bg-zinc-600'
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[color:var(--muted)]">
      <span className={`dot ${color}`} aria-hidden />
      {status}
    </span>
  )
}

function fmtDateLong(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
