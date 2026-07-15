'use client'

import { useState, useTransition } from 'react'
import { updateShift, deleteShift, type ShiftPatchInput } from '../actions'
import {
  shiftPaidHours,
  shiftPay,
  shiftGrossPay,
  shiftMealDeduction,
  formatMinutes,
  shiftPaidMinutes,
} from '@/lib/payroll'
import { EmployeeCombobox } from '@/app/_components/EmployeeCombobox'
import { departmentForRole } from '@/lib/roles'
import type { Shift, Employee } from '@/lib/types/db'

/**
 * Groups shifts by their own work_date — used for hostess_bar weekly sheets,
 * where one sheet's shifts span 7 different days. Servers/bus shifts all
 * have work_date=null, so they always collapse to a single ungrouped group
 * (no header rendered) — this renders identically to before for them.
 */
function groupShiftsByDate(shifts: Shift[]): { date: string | null; shifts: Shift[] }[] {
  const map = new Map<string | null, Shift[]>()
  for (const s of shifts) {
    const key = s.work_date ?? null
    const arr = map.get(key) ?? []
    arr.push(s)
    map.set(key, arr)
  }
  if (map.size <= 1) return [{ date: null, shifts }]
  return Array.from(map.entries())
    .sort(([a], [b]) => (a ?? '').localeCompare(b ?? ''))
    .map(([date, dateShifts]) => ({ date, shifts: dateShifts }))
}

function fmtGroupDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export function ShiftRows({
  shifts,
  sheetId,
  employees,
  readOnly = false,
}: {
  shifts: Shift[]
  sheetId: string
  employees: Employee[]
  readOnly?: boolean
}) {
  const groups = groupShiftsByDate(shifts)
  const colCount = readOnly ? 10 : 11
  return (
    <div className="surface overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="border-b border-[color:var(--border)] text-left text-xs font-normal text-[color:var(--muted)]">
          <tr>
            <th className="px-3 py-2.5 font-normal">Employee</th>
            <th className="px-3 py-2.5 font-normal">Sect</th>
            <th className="px-3 py-2.5 font-normal">Start</th>
            <th className="px-3 py-2.5 font-normal">End</th>
            <th className="px-3 py-2.5 font-normal text-right">Break</th>
            <th className="px-3 py-2.5 font-normal text-center">Meal</th>
            <th className="px-3 py-2.5 font-normal text-right">Rate</th>
            <th className="px-3 py-2.5 font-normal text-right">Hours</th>
            <th className="px-3 py-2.5 font-normal text-right">Pay</th>
            <th className="px-3 py-2.5 font-normal">Notes</th>
            {!readOnly && <th className="px-3 py-2.5 font-normal" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--border)]">
          {groups.map((g) => (
            <SheetGroup
              key={g.date ?? 'ungrouped'}
              date={g.date}
              shifts={g.shifts}
              sheetId={sheetId}
              employees={employees}
              readOnly={readOnly}
              colCount={colCount}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SheetGroup({
  date,
  shifts,
  sheetId,
  employees,
  readOnly,
  colCount,
}: {
  date: string | null
  shifts: Shift[]
  sheetId: string
  employees: Employee[]
  readOnly: boolean
  colCount: number
}) {
  return (
    <>
      {date && (
        <tr>
          <td colSpan={colCount} className="bg-[color:var(--surface-container)] px-3 py-1.5 text-xs font-medium text-[color:var(--muted)]">
            {fmtGroupDate(date)}
          </td>
        </tr>
      )}
      {shifts.map((s) => (
        <Row key={s.id} shift={s} sheetId={sheetId} employees={employees} readOnly={readOnly} />
      ))}
    </>
  )
}

function Row({
  shift,
  sheetId,
  employees,
  readOnly,
}: {
  shift: Shift
  sheetId: string
  employees: Employee[]
  readOnly: boolean
}) {
  const [s, setS] = useState(shift)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function commit(patch: ShiftPatchInput) {
    setError(null)
    startTransition(async () => {
      try {
        await updateShift(s.id, patch, sheetId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed')
      }
    })
  }

  function setField<K extends keyof Shift>(key: K, value: Shift[K]) {
    setS((cur) => ({ ...cur, [key]: value }))
  }

  function onEmployeeChange(picked: { id: string | null; label: string }) {
    if (picked.id) {
      const e = employees.find((x) => x.id === picked.id)
      if (e) {
        // Keep the shift's department/role snapshot in sync with whichever
        // employee is now linked, mirroring app/scan/actions.ts's OCR path —
        // otherwise re-linking a shift to a different-department employee
        // leaves the old snapshot in place.
        setS((cur) => ({
          ...cur,
          employee_id: e.id,
          employee_name_snapshot: e.full_name,
          hourly_rate_snapshot: e.hourly_rate,
          role: e.role,
          department: e.department,
        }))
        commit({
          employee_id: e.id,
          employee_name_snapshot: e.full_name,
          hourly_rate_snapshot: e.hourly_rate,
          role: e.role,
          department: e.department,
        })
        return
      }
    }
    // Custom typed name — unlink from any roster employee, keep typed text.
    setS((cur) => ({
      ...cur,
      employee_id: null,
      employee_name_snapshot: picked.label,
      department: departmentForRole(cur.role),
    }))
    commit({ employee_id: null, employee_name_snapshot: picked.label, department: departmentForRole(s.role) })
  }

  const minutes = shiftPaidMinutes(s)
  const hours = shiftPaidHours(s)
  const grossPay = shiftGrossPay(s)
  const mealDeduction = shiftMealDeduction(s)
  const pay = shiftPay(s)
  // hostess_bar weekly sheets carry a bookkeeper-provided total instead of
  // start/end times — see lib/payroll.ts. Never "incomplete" since there's
  // no clock-time pair to be missing.
  const isOverride = s.net_minutes_override != null
  const incomplete = !isOverride && (!s.start_time || !s.end_time)

  if (readOnly) {
    return (
      <tr className={s.needs_review ? 'bg-amber-50/60 dark:bg-amber-950/20' : 'bg-emerald-50/30 dark:bg-emerald-950/10'}>
        <td className="px-3 py-2">
          {s.employee_name_snapshot}
          {s.needs_review && (
            <p className="mt-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">⚠ verify OCR</p>
          )}
        </td>
        <td className="px-3 py-2">{isOverride ? '—' : s.section ?? '—'}</td>
        <td className="px-3 py-2 tabular-nums">{isOverride ? `${hours.toFixed(2)}h (week)` : s.start_time ?? '—'}</td>
        <td className="px-3 py-2 tabular-nums">{isOverride ? '—' : s.end_time ?? '—'}</td>
        <td className="px-3 py-2 text-right tabular-nums">{isOverride ? '—' : `${s.break_minutes}m`}</td>
        <td className="px-3 py-2 text-center">{isOverride ? `$${mealDeduction.toFixed(2)}` : s.meal_provided ? '✓' : ''}</td>
        <td className="px-3 py-2 text-right tabular-nums">${s.hourly_rate_snapshot.toFixed(2)}</td>
        <td className="px-3 py-2 text-right tabular-nums">
          {incomplete ? '—' : hours.toFixed(2)}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {incomplete ? '—' : `$${pay.toFixed(2)}`}
          {!incomplete && mealDeduction > 0 && (
            <div
              className="text-[10px] text-[color:var(--muted)]"
              title={`Gross $${grossPay.toFixed(2)} − $${mealDeduction.toFixed(2)} meal`}
            >
              −${mealDeduction.toFixed(2)} meal
            </div>
          )}
        </td>
        <td className="px-3 py-2 text-[color:var(--muted)]">{s.notes ?? ''}</td>
      </tr>
    )
  }

  if (isOverride) {
    return (
      <tr className={s.needs_review ? 'bg-amber-50/40 dark:bg-amber-950/10' : ''}>
        <td className="px-3 py-2">
          <EmployeeCombobox
            options={employees.map((e) => ({ id: e.id, label: e.full_name, sublabel: e.role ?? undefined }))}
            value={s.employee_id}
            customLabel={s.employee_name_snapshot}
            onChange={onEmployeeChange}
            disabled={pending}
            className="min-w-44"
          />
          {!s.employee_id && (
            <p className="mt-1 text-[10px] text-[color:var(--muted)]">unlinked from roster</p>
          )}
        </td>
        <td className="px-3 py-2 text-[color:var(--muted)]" colSpan={5}>
          <div className="flex items-center gap-4">
            <label className="text-xs">
              <span className="mb-1 block text-[color:var(--muted)]">Net hours (week)</span>
              <input
                type="number"
                step="0.25"
                min="0"
                className="input w-24"
                value={(s.net_minutes_override ?? 0) / 60}
                onChange={(e) => setField('net_minutes_override', Math.round(Number(e.target.value) * 60))}
                onBlur={() => commit({ net_minutes_override: s.net_minutes_override })}
              />
            </label>
            <label className="text-xs">
              <span className="mb-1 block text-[color:var(--muted)]">Meal ded. $</span>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input w-24"
                value={s.meal_deduction_override ?? 0}
                onChange={(e) => setField('meal_deduction_override', Number(e.target.value))}
                onBlur={() => commit({ meal_deduction_override: s.meal_deduction_override })}
              />
            </label>
          </div>
        </td>
        <td className="px-3 py-2 text-right">
          <input
            type="number"
            step="0.01"
            min="0"
            className="input w-20 text-right"
            value={s.hourly_rate_snapshot}
            onChange={(e) => setField('hourly_rate_snapshot', Number(e.target.value))}
            onBlur={() => commit({ hourly_rate_snapshot: s.hourly_rate_snapshot })}
          />
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{hours.toFixed(2)}</td>
        <td className="px-3 py-2 text-right tabular-nums">
          ${pay.toFixed(2)}
          {mealDeduction > 0 && (
            <div
              className="text-[10px] text-[color:var(--muted)]"
              title={`Gross $${grossPay.toFixed(2)} − $${mealDeduction.toFixed(2)} meal`}
            >
              −${mealDeduction.toFixed(2)} meal
            </div>
          )}
        </td>
        <td className="px-3 py-2">
          <input
            className="input"
            value={s.notes ?? ''}
            maxLength={500}
            onChange={(e) => setField('notes', e.target.value || null)}
            onBlur={() => commit({ notes: s.notes ?? null })}
          />
          {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
          {pending && <p className="mt-1 text-[10px] text-[color:var(--muted)]">saving…</p>}
        </td>
        <td className="px-3 py-2 text-right">
          <DeleteShiftButton id={s.id} sheetId={sheetId} name={s.employee_name_snapshot} />
        </td>
      </tr>
    )
  }

  return (
    <tr className={s.needs_review ? 'bg-amber-50/40 dark:bg-amber-950/10' : ''}>
      <td className="px-3 py-2">
        <EmployeeCombobox
          options={employees.map((e) => ({
            id: e.id,
            label: e.full_name,
            sublabel: e.role ?? undefined,
          }))}
          value={s.employee_id}
          customLabel={s.employee_name_snapshot}
          onChange={onEmployeeChange}
          disabled={pending}
          className="min-w-44"
        />
        {!s.employee_id && (
          <p className="mt-1 text-[10px] text-[color:var(--muted)]">unlinked from roster</p>
        )}
        {s.needs_review && (
          <p className="mt-1 text-[10px] font-medium text-amber-700 dark:text-amber-400">⚠ verify OCR</p>
        )}
      </td>
      <td className="px-3 py-2">
        <select
          className="input w-16"
          value={s.section ?? ''}
          onChange={(e) => {
            const v = e.target.value || null
            setField('section', v)
            commit({ section: v })
          }}
        >
          <option value="">—</option>
          {['A', 'B', 'C', 'D', 'E', 'F'].map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          type="time"
          className="input w-28"
          value={s.start_time ?? ''}
          onChange={(e) => setField('start_time', e.target.value || null)}
          onBlur={() => commit({ start_time: s.start_time ?? null })}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="time"
          className="input w-28"
          value={s.end_time ?? ''}
          onChange={(e) => setField('end_time', e.target.value || null)}
          onBlur={() => commit({ end_time: s.end_time ?? null })}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          min="0"
          className="input w-20 text-right"
          value={s.break_minutes}
          onChange={(e) => setField('break_minutes', Number(e.target.value))}
          onBlur={() => commit({ break_minutes: s.break_minutes })}
        />
      </td>
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          checked={s.meal_provided}
          onChange={(e) => {
            setField('meal_provided', e.target.checked)
            commit({ meal_provided: e.target.checked })
          }}
        />
      </td>
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          step="0.01"
          min="0"
          className="input w-20 text-right"
          value={s.hourly_rate_snapshot}
          onChange={(e) => setField('hourly_rate_snapshot', Number(e.target.value))}
          onBlur={() => commit({ hourly_rate_snapshot: s.hourly_rate_snapshot })}
        />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {incomplete ? <span className="text-[color:var(--muted)]">—</span> : hours.toFixed(2)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {incomplete ? <span className="text-[color:var(--muted)]">—</span> : `$${pay.toFixed(2)}`}
        {!incomplete && mealDeduction > 0 && (
          <div
            className="text-[10px] text-[color:var(--muted)]"
            title={`Gross $${grossPay.toFixed(2)} − $${mealDeduction.toFixed(2)} meal`}
          >
            −${mealDeduction.toFixed(2)} meal
          </div>
        )}
        {minutes > 0 && (
          <div className="text-[10px] text-[color:var(--muted)]">{formatMinutes(minutes)}</div>
        )}
      </td>
      <td className="px-3 py-2">
        <input
          className="input"
          value={s.notes ?? ''}
          maxLength={500}
          onChange={(e) => setField('notes', e.target.value || null)}
          onBlur={() => commit({ notes: s.notes ?? null })}
        />
        {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
        {pending && <p className="mt-1 text-[10px] text-[color:var(--muted)]">saving…</p>}
      </td>
      <td className="px-3 py-2 text-right">
        <DeleteShiftButton id={s.id} sheetId={sheetId} name={s.employee_name_snapshot} />
      </td>
    </tr>
  )
}

function DeleteShiftButton({
  id,
  sheetId,
}: {
  id: string
  sheetId: string
  name: string
}) {
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  if (confirming) {
    return (
      <span className="flex items-center justify-end gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await deleteShift(id, sheetId)
            })
          }
          className="text-xs font-medium text-rose-600 hover:text-rose-800 disabled:opacity-50 dark:text-rose-400"
        >
          {pending ? '…' : 'Delete'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)]"
        >
          Cancel
        </button>
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="text-xs text-rose-600 hover:text-rose-800 dark:text-rose-400"
    >
      Delete
    </button>
  )
}
