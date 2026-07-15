'use client'

import { useMemo, useState, useTransition } from 'react'
import { setAlcoholPoints } from '../actions'
import { tracksAlcoholPoints } from '@/lib/roles'
import type { AlcoholSale, Employee, Shift } from '@/lib/types/db'


type Row = {
  key: string
  employee_id: string | null
  employee_name: string
  points: number
  saleId: string | null
  fromShift: boolean
  pending: boolean
  error: string | null
}

export function AlcoholSection({
  sheetId,
  shifts,
  alcoholSales,
  employees,
  readOnly = false,
}: {
  sheetId: string
  shifts: Shift[]
  alcoholSales: AlcoholSale[]
  employees: Employee[]
  readOnly?: boolean
}) {
  const empTracksMap = useMemo(
    () => new Map(employees.map((e) => [e.id, e.tracks_alcohol_points])),
    [employees]
  )
  const initialRows = useMemo(
    () => buildInitialRows(shifts, alcoholSales, empTracksMap),
    [shifts, alcoholSales, empTracksMap]
  )
  const [rows, setRows] = useState<Row[]>(initialRows)

  const sorted = [...rows].sort((a, b) => a.employee_name.localeCompare(b.employee_name))
  const totalPoints = sorted.reduce((sum, r) => sum + r.points, 0)

  function patch(key: string, p: Partial<Row>) {
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...p } : r)))
  }

  function addAdHoc() {
    const name = prompt('Server name (not on this sheet)')?.trim()
    if (!name) return
    const employee = employees.find(
      (e) => e.full_name.toLowerCase() === name.toLowerCase() && e.tracks_alcohol_points
    )
    const key = employee ? employee.id : `__name__:${name.toLowerCase()}`
    if (rows.some((r) => r.key === key)) return
    setRows((cur) => [
      ...cur,
      {
        key,
        employee_id: employee?.id ?? null,
        employee_name: employee?.full_name ?? name,
        points: 0,
        saleId: null,
        fromShift: false,
        pending: false,
        error: null,
      },
    ])
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Alcohol sales</h2>
          <p className="text-xs text-[color:var(--muted)]">
            Tap + or − to tally drink points per server. Buspersons are excluded.
          </p>
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Day total: <span className="font-semibold tabular-nums">{totalPoints}</span>
        </p>
      </div>

      <div className="surface overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b border-[color:var(--border)] text-left text-xs font-normal text-[color:var(--muted)]">
            <tr>
              <th className="px-3 py-2.5 font-normal">Server</th>
              <th className="px-3 py-2.5 font-normal text-right">Points</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--border)]">
            {sorted.map((r) => (
              <PointsRow
                key={r.key}
                row={r}
                sheetId={sheetId}
                onPatch={(p) => patch(r.key, p)}
                readOnly={readOnly}
              />
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={2} className="px-3 py-6 text-center text-sm text-[color:var(--muted)]">
                  No servers on this sheet yet. Add a shift first or add a server below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="mt-3">
          <button type="button" onClick={addAdHoc} className="btn-secondary text-xs">
            + Add server not on shift
          </button>
        </div>
      )}
    </section>
  )
}

function PointsRow({
  row,
  sheetId,
  onPatch,
  readOnly,
}: {
  row: Row
  sheetId: string
  onPatch: (p: Partial<Row>) => void
  readOnly: boolean
}) {
  const [pending, startTransition] = useTransition()

  function adjust(delta: number) {
    const next = Math.max(0, row.points + delta)
    if (next === row.points) return
    const prev = row.points
    onPatch({ points: next, error: null })
    startTransition(async () => {
      try {
        await setAlcoholPoints({
          daily_sheet_id: sheetId,
          employee_id: row.employee_id,
          employee_name: row.employee_name,
          drink_points: next,
        })
      } catch (e) {
        onPatch({ points: prev, error: e instanceof Error ? e.message : 'Save failed' })
      }
    })
  }

  return (
    <tr>
      <td className="px-3 py-2.5">
        <span className="font-medium">{row.employee_name}</span>
        {!row.fromShift && (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-[color:var(--muted)]">
            ad-hoc
          </span>
        )}
        {row.error && <p className="mt-0.5 text-xs text-rose-600">{row.error}</p>}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end gap-2">
          {!readOnly && (
            <button
              type="button"
              onClick={() => adjust(-1)}
              disabled={pending || row.points === 0}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[color:var(--border)] text-lg font-medium leading-none text-[color:var(--muted)] transition hover:bg-black/5 hover:text-[color:var(--foreground)] disabled:opacity-30 dark:hover:bg-white/5"
              aria-label={`Remove one point from ${row.employee_name}`}
            >
              −
            </button>
          )}
          <span
            className={`w-8 text-center text-base font-semibold tabular-nums ${
              pending ? 'opacity-50' : ''
            }`}
          >
            {row.points}
          </span>
          {!readOnly && (
            <button
              type="button"
              onClick={() => adjust(+1)}
              disabled={pending}
              className="flex h-8 w-8 items-center justify-center rounded-md border border-[color:var(--border)] text-lg font-medium leading-none text-[color:var(--muted)] transition hover:bg-black/5 hover:text-[color:var(--foreground)] disabled:opacity-30 dark:hover:bg-white/5"
              aria-label={`Add one point to ${row.employee_name}`}
            >
              +
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

function buildInitialRows(
  shifts: Shift[],
  sales: AlcoholSale[],
  empTracksMap: Map<string, boolean>
): Row[] {
  const map = new Map<string, Row>()

  for (const sh of shifts) {
    // Exclude roles that don't track alcohol points — check the live employee
    // record first, fall back to deriving it from the shift's role snapshot.
    const tracks = sh.employee_id
      ? empTracksMap.get(sh.employee_id) ?? tracksAlcoholPoints(sh.role)
      : tracksAlcoholPoints(sh.role)
    if (!tracks) continue

    const key = sh.employee_id ?? `__name__:${sh.employee_name_snapshot.toLowerCase()}`
    if (!map.has(key)) {
      map.set(key, {
        key,
        employee_id: sh.employee_id,
        employee_name: sh.employee_name_snapshot,
        points: 0,
        saleId: null,
        fromShift: true,
        pending: false,
        error: null,
      })
    }
  }

  for (const a of sales) {
    const key = a.employee_id ?? `__name__:${a.employee_name_snapshot.toLowerCase()}`
    const existing = map.get(key)
    if (existing) {
      existing.points = a.drink_points
      existing.saleId = a.id
    } else {
      map.set(key, {
        key,
        employee_id: a.employee_id,
        employee_name: a.employee_name_snapshot,
        points: a.drink_points,
        saleId: a.id,
        fromShift: false,
        pending: false,
        error: null,
      })
    }
  }

  return Array.from(map.values())
}
