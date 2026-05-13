'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  deleteAllEmployees,
  deleteEmployee,
  deleteEmployees,
  setAllWagesToMinimum,
  toggleEmployeeActive,
  updateEmployeeRate,
} from './actions'
import { InlineWageEditor } from './InlineWageEditor'
import { ONTARIO_WAGE_PRESETS } from '@/lib/wages'
import type { Employee } from '@/lib/types/db'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const NON_ALPHA = '#'
const PAGE_SIZE = 10

export function EmployeesClient({ employees }: { employees: Employee[] }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return employees
    return employees.filter(
      (e) =>
        e.full_name.toLowerCase().includes(q) ||
        (e.role ?? '').toLowerCase().includes(q)
    )
  }, [employees, query])

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) =>
        a.full_name.localeCompare(b.full_name, undefined, { sensitivity: 'base' })
      ),
    [filtered]
  )

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))

  // Reset to page 1 whenever the filter changes results, and clamp the
  // current page if a delete shrank the list.
  useEffect(() => {
    setPage(1)
  }, [query])
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  // First-occurrence-of-letter mapping is computed across the FULL filtered
  // list so the alphabet rail can jump to the correct page even when that
  // letter isn't on the current one.
  const letterToPage = useMemo(() => {
    const m = new Map<string, number>()
    sorted.forEach((e, i) => {
      const ch = letterFor(e.full_name)
      if (!m.has(ch)) m.set(ch, Math.floor(i / PAGE_SIZE) + 1)
    })
    return m
  }, [sorted])

  const pageStart = (page - 1) * PAGE_SIZE
  const pageRows = sorted.slice(pageStart, pageStart + PAGE_SIZE)

  function toggleOne(id: string) {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllOnPage() {
    setSelected((cur) => {
      const next = new Set(cur)
      pageRows.forEach((e) => next.add(e.id))
      return next
    })
  }

  function clearSelection() {
    setSelected(new Set())
  }

  function exitSelectMode() {
    setSelectMode(false)
    clearSelection()
  }

  function jumpToLetter(letter: string) {
    const target = letterToPage.get(letter)
    if (target) setPage(target)
  }

  function onDeleteSelected() {
    if (selected.size === 0) return
    const names = employees
      .filter((e) => selected.has(e.id))
      .map((e) => e.full_name)
    const preview =
      names.length <= 5 ? names.join(', ') : `${names.slice(0, 5).join(', ')}, +${names.length - 5} more`
    if (
      !confirm(
        `Delete ${selected.size} employee${selected.size === 1 ? '' : 's'}? Past shifts and alcohol sales stay (the name is preserved on each row).\n\n${preview}`
      )
    )
      return
    setError(null)
    startTransition(async () => {
      try {
        await deleteEmployees(Array.from(selected))
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Delete failed')
      } finally {
        setSelectMode(false)
        clearSelection()
      }
    })
  }

  function onDeleteAll() {
    if (employees.length === 0) return
    if (
      !confirm(
        `Delete ALL ${employees.length} employees? This empties the entire roster. Past shifts/alcohol sales keep their name snapshots, but you will need to re-add everyone.\n\nThis cannot be undone.`
      )
    )
      return
    setError(null)
    startTransition(async () => {
      try {
        await deleteAllEmployees()
        clearSelection()
        setSelectMode(false)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Delete failed')
      }
    })
  }

  function onResetWagesToMinimum() {
    if (employees.length === 0) return
    const minRate = ONTARIO_WAGE_PRESETS.minimum.rate
    if (
      !confirm(
        `Set every employee's hourly rate to Ontario minimum wage ($${minRate.toFixed(
          2
        )})? Past shifts keep their original snapshot rate, so historical pay is unaffected — only future shifts will use the new rate.`
      )
    )
      return
    setError(null)
    startTransition(async () => {
      try {
        await setAllWagesToMinimum()
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Reset failed')
      }
    })
  }

  if (employees.length === 0) {
    return (
      <div className="surface border-dashed p-10 text-center">
        <p className="text-sm text-[color:var(--muted)]">No employees yet.</p>
        <Link href="/employees/new" className="btn-primary mt-4 inline-flex">
          Add the first one
        </Link>
      </div>
    )
  }

  const rangeFrom = sorted.length === 0 ? 0 : pageStart + 1
  const rangeTo = Math.min(pageStart + PAGE_SIZE, sorted.length)

  return (
    <div className="space-y-4">
      <Toolbar
        query={query}
        setQuery={setQuery}
        selectMode={selectMode}
        setSelectMode={setSelectMode}
        selectedCount={selected.size}
        pageRowsCount={pageRows.length}
        totalCount={employees.length}
        onSelectAllOnPage={selectAllOnPage}
        onClearSelection={clearSelection}
        onExitSelectMode={exitSelectMode}
        onDeleteSelected={onDeleteSelected}
        onDeleteAll={onDeleteAll}
        onResetWagesToMinimum={onResetWagesToMinimum}
        pending={pending}
      />

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200">
          {error}
        </div>
      )}

      <div className="relative">
        <div className="surface overflow-hidden">
          {sorted.length === 0 ? (
            <div className="p-10 text-center text-sm text-[color:var(--muted)]">
              No matches for &quot;{query}&quot;.
            </div>
          ) : (
            <PageList
              rows={pageRows}
              startIndex={pageStart + 1}
              selectMode={selectMode}
              selected={selected}
              onToggle={toggleOne}
            />
          )}
        </div>

        <AlphabetJump
          lettersWithRows={new Set(letterToPage.keys())}
          onJump={jumpToLetter}
        />
      </div>

      {sorted.length > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          rangeFrom={rangeFrom}
          rangeTo={rangeTo}
          totalCount={sorted.length}
          onPrev={() => setPage((p) => Math.max(1, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          onJump={setPage}
        />
      )}
    </div>
  )
}

function Toolbar({
  query,
  setQuery,
  selectMode,
  setSelectMode,
  selectedCount,
  pageRowsCount,
  totalCount,
  onSelectAllOnPage,
  onClearSelection,
  onExitSelectMode,
  onDeleteSelected,
  onDeleteAll,
  onResetWagesToMinimum,
  pending,
}: {
  query: string
  setQuery: (s: string) => void
  selectMode: boolean
  setSelectMode: (v: boolean) => void
  selectedCount: number
  pageRowsCount: number
  totalCount: number
  onSelectAllOnPage: () => void
  onClearSelection: () => void
  onExitSelectMode: () => void
  onDeleteSelected: () => void
  onDeleteAll: () => void
  onResetWagesToMinimum: () => void
  pending: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[14rem] max-w-md">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--muted)]">
          ⌕
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${totalCount} employee${totalCount === 1 ? '' : 's'}…`}
          className="input pl-7"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {selectMode ? (
          <>
            <span className="text-xs text-[color:var(--muted)]">
              {selectedCount} selected
            </span>
            <button
              type="button"
              onClick={onSelectAllOnPage}
              className="btn-ghost text-xs"
              disabled={pending || pageRowsCount === 0}
            >
              Select page
            </button>
            <button
              type="button"
              onClick={onClearSelection}
              className="btn-ghost text-xs"
              disabled={pending || selectedCount === 0}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={onDeleteSelected}
              disabled={pending || selectedCount === 0}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-40"
            >
              {pending ? 'Deleting…' : `Delete ${selectedCount > 0 ? selectedCount : ''}`}
            </button>
            <button
              type="button"
              onClick={onExitSelectMode}
              disabled={pending}
              className="btn-secondary text-xs"
            >
              Done
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setSelectMode(true)}
              className="btn-secondary text-xs"
              disabled={pending || totalCount === 0}
            >
              Select
            </button>
            <button
              type="button"
              onClick={onResetWagesToMinimum}
              disabled={pending || totalCount === 0}
              title={`Sets every employee's rate to $${ONTARIO_WAGE_PRESETS.minimum.rate.toFixed(2)} — past shifts unaffected`}
              className="btn-ghost text-xs"
            >
              Reset wages → min
            </button>
            <button
              type="button"
              onClick={onDeleteAll}
              disabled={pending || totalCount === 0}
              className="text-xs text-rose-600 transition hover:text-rose-700 disabled:opacity-40 dark:text-rose-400"
            >
              {pending ? 'Working…' : 'Delete all'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function PageList({
  rows,
  startIndex,
  selectMode,
  selected,
  onToggle,
}: {
  rows: Employee[]
  startIndex: number
  selectMode: boolean
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <ul>
      {rows.map((e, i) => {
        const idx = startIndex + i
        const dividerClass = i === 0 ? '' : 'border-t border-[color:var(--border)]'
        return (
          <li key={e.id} className={dividerClass}>
            <Row
              employee={e}
              index={idx}
              selectMode={selectMode}
              selected={selected.has(e.id)}
              onToggle={() => onToggle(e.id)}
            />
          </li>
        )
      })}
    </ul>
  )
}

function Row({
  employee,
  index,
  selectMode,
  selected,
  onToggle,
}: {
  employee: Employee
  index: number
  selectMode: boolean
  selected: boolean
  onToggle: () => void
}) {
  const e = employee
  const baseRow =
    'group flex items-center gap-3 px-4 py-2.5 transition hover:bg-black/5 dark:hover:bg-white/5'

  // In selection mode the whole row toggles. Otherwise the row is NOT a link
  // — only the name links to the detail page so the inline wage dropdown,
  // checkboxes, and hover actions can be clicked without navigating away.
  if (selectMode) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={`${baseRow} w-full text-left ${selected ? 'bg-black/5 dark:bg-white/5' : ''}`}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={(ev) => ev.stopPropagation()}
          aria-label={`Select ${e.full_name}`}
          className="h-4 w-4 cursor-pointer"
        />
        <span
          className="shrink-0 w-7 text-right text-[11px] tabular-nums text-[color:var(--muted)]"
          aria-hidden
        >
          {index}
        </span>
        <NameBlock employee={e} />
      </button>
    )
  }

  return (
    <div className={baseRow}>
      <span
        className="shrink-0 w-7 text-right text-[11px] tabular-nums text-[color:var(--muted)]"
        aria-hidden
      >
        {index}
      </span>
      <Link
        href={`/employees/${e.id}`}
        className="min-w-0 flex-1 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/40"
      >
        <NameBlock employee={e} />
      </Link>
      <div className="hidden shrink-0 items-center gap-3 sm:flex">
        <InlineWageEditor id={e.id} initialRate={e.hourly_rate} action={updateEmployeeRate} />
      </div>
      <RowActions id={e.id} active={e.active} name={e.full_name} />
    </div>
  )
}

function NameBlock({ employee }: { employee: Employee }) {
  const e = employee
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span
          className={`truncate text-sm font-medium ${
            e.active ? '' : 'text-[color:var(--muted)]'
          }`}
        >
          {e.full_name}
        </span>
        {!e.active && (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-[color:var(--muted)]">
            <span className="dot bg-zinc-400 dark:bg-zinc-600" />
            inactive
          </span>
        )}
      </div>
      <div className="mt-0.5 truncate text-xs text-[color:var(--muted)]">
        {[
          e.role || 'No role',
          `${e.default_break_minutes}m break`,
          e.default_meal_provided ? 'meal' : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </div>
    </div>
  )
}

function RowActions({
  id,
  active,
  name,
}: {
  id: string
  active: boolean
  name: string
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function onToggleActive(ev: React.MouseEvent) {
    ev.preventDefault()
    ev.stopPropagation()
    startTransition(async () => {
      await toggleEmployeeActive(id, !active)
      router.refresh()
    })
  }

  function onDelete(ev: React.MouseEvent) {
    ev.preventDefault()
    ev.stopPropagation()
    if (
      !confirm(
        `Delete ${name}? Their past shifts and alcohol sales stay (the name is preserved on each row).`
      )
    )
      return
    startTransition(async () => {
      await deleteEmployee(id)
      router.refresh()
    })
  }

  return (
    <div className="hidden shrink-0 items-center gap-3 opacity-0 transition group-hover:opacity-100 sm:flex">
      <button
        type="button"
        onClick={onToggleActive}
        disabled={pending}
        className="text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)] disabled:opacity-50"
      >
        {active ? 'Deactivate' : 'Reactivate'}
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="text-xs text-rose-600 hover:text-rose-700 disabled:opacity-50 dark:text-rose-400"
      >
        Delete
      </button>
    </div>
  )
}

function Pagination({
  page,
  totalPages,
  rangeFrom,
  rangeTo,
  totalCount,
  onPrev,
  onNext,
  onJump,
}: {
  page: number
  totalPages: number
  rangeFrom: number
  rangeTo: number
  totalCount: number
  onPrev: () => void
  onNext: () => void
  onJump: (page: number) => void
}) {
  const canPrev = page > 1
  const canNext = page < totalPages
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p className="text-[color:var(--muted)]">
        Showing <span className="font-medium text-[color:var(--foreground)]">{rangeFrom}–{rangeTo}</span> of{' '}
        <span className="font-medium text-[color:var(--foreground)]">{totalCount}</span>
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={!canPrev}
          className="btn-secondary disabled:opacity-40"
          aria-label="Previous 10"
        >
          ← Prev 10
        </button>
        <span className="px-2 text-xs text-[color:var(--muted)]">
          Page {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          className="btn-primary disabled:opacity-40"
          aria-label="Next 10"
        >
          Next 10 →
        </button>
        {totalPages > 2 && (
          <select
            value={page}
            onChange={(e) => onJump(Number(e.target.value))}
            aria-label="Jump to page"
            className="input ml-2 hidden w-auto sm:inline-block"
          >
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <option key={p} value={p}>
                Page {p}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

function AlphabetJump({
  lettersWithRows,
  onJump,
}: {
  lettersWithRows: Set<string>
  onJump: (letter: string) => void
}) {
  const all = [...ALPHABET, NON_ALPHA]
  return (
    <nav
      aria-label="Jump to letter"
      className="pointer-events-none absolute right-1 top-2 hidden flex-col items-center gap-0.5 lg:flex"
    >
      {all.map((l) => {
        const active = lettersWithRows.has(l)
        return (
          <button
            key={l}
            type="button"
            tabIndex={active ? 0 : -1}
            onClick={() => active && onJump(l)}
            className={`pointer-events-auto rounded px-1 text-[10px] leading-tight transition ${
              active
                ? 'text-[color:var(--muted)] hover:text-[color:var(--foreground)]'
                : 'text-[color:var(--border-strong)]'
            }`}
          >
            {l}
          </button>
        )
      })}
    </nav>
  )
}

// ---- helpers ----

function letterFor(name: string): string {
  const ch = (name.trim()[0] ?? '').toUpperCase()
  return /[A-Z]/.test(ch) ? ch : NON_ALPHA
}
