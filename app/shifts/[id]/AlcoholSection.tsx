'use client'

import { useMemo, useState, useTransition } from 'react'
import { setAlcoholPoints } from '../actions'
import type { AlcoholSale, Employee, Shift } from '@/lib/types/db'

const OTHER = '__other__'

type Row = {
  key: string                          // employee_id or `__name__:foo`
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
  const initialRows = useMemo(() => buildInitialRows(shifts, alcoholSales), [shifts, alcoholSales])
  const [rows, setRows] = useState<Row[]>(initialRows)

  // Sort alphabetically for stability.
  const sorted = [...rows].sort((a, b) => a.employee_name.localeCompare(b.employee_name))
  const totalPoints = sorted.reduce((sum, r) => sum + r.points, 0)

  function patch(key: string, patch: Partial<Row>) {
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function addAdHoc() {
    const name = prompt('Server name (not on this sheet)')?.trim()
    if (!name) return
    const employee = employees.find((e) => e.full_name.toLowerCase() === name.toLowerCase())
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
            Drink-point tally per server. Set to 0 to remove a row.
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
              <th className="px-3 py-2.5 font-normal" />
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
                <td colSpan={3} className="px-3 py-6 text-center text-sm text-[color:var(--muted)]">
                  No employees on this sheet yet. Add a shift first or add a server below.
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
  const [input, setInput] = useState(row.points.toString())
  const [pending, startTransition] = useTransition()

  function commit() {
    const parsed = Number(input)
    if (!Number.isFinite(parsed) || parsed < 0) {
      onPatch({ error: 'Invalid' })
      setInput(row.points.toString())
      return
    }
    if (parsed === row.points) return
    onPatch({ error: null })
    startTransition(async () => {
      try {
        await setAlcoholPoints({
          daily_sheet_id: sheetId,
          employee_id: row.employee_id,
          employee_name: row.employee_name,
          drink_points: parsed,
        })
        onPatch({ points: parsed, error: null })
      } catch (e) {
        onPatch({ error: e instanceof Error ? e.message : 'Save failed' })
        setInput(row.points.toString())
      }
    })
  }

  return (
    <tr>
      <td className="px-3 py-2">
        <span className="font-medium">{row.employee_name}</span>
        {!row.fromShift && (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-[color:var(--muted)]">ad-hoc</span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          min="0"
          inputMode="numeric"
          className="input w-20 text-right tabular-nums"
          value={input}
          disabled={pending || readOnly}
          onChange={(e) => setInput(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setInput(row.points.toString())
              ;(e.target as HTMLInputElement).blur()
            }
          }}
        />
        {pending && <p className="mt-1 text-[10px] text-[color:var(--muted)]">saving…</p>}
        {row.error && <p className="mt-1 text-xs text-rose-600">{row.error}</p>}
      </td>
      <td className="px-3 py-2 text-right" />
    </tr>
  )
}

function buildInitialRows(shifts: Shift[], sales: AlcoholSale[]): Row[] {
  const map = new Map<string, Row>()

  for (const sh of shifts) {
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
