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
import type { Shift, Employee } from '@/lib/types/db'

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
          {shifts.map((s) => (
            <Row key={s.id} shift={s} sheetId={sheetId} employees={employees} readOnly={readOnly} />
          ))}
        </tbody>
      </table>
    </div>
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
        setS((cur) => ({
          ...cur,
          employee_id: e.id,
          employee_name_snapshot: e.full_name,
          hourly_rate_snapshot: e.hourly_rate,
        }))
        commit({
          employee_id: e.id,
          employee_name_snapshot: e.full_name,
          hourly_rate_snapshot: e.hourly_rate,
        })
        return
      }
    }
    // Custom typed name — unlink from any roster employee, keep typed text.
    setS((cur) => ({
      ...cur,
      employee_id: null,
      employee_name_snapshot: picked.label,
    }))
    commit({ employee_id: null, employee_name_snapshot: picked.label })
  }

  const minutes = shiftPaidMinutes(s)
  const hours = shiftPaidHours(s)
  const grossPay = shiftGrossPay(s)
  const mealDeduction = shiftMealDeduction(s)
  const pay = shiftPay(s)
  const incomplete = !s.start_time || !s.end_time

  if (readOnly) {
    return (
      <tr className="bg-emerald-50/30 dark:bg-emerald-950/10">
        <td className="px-3 py-2">{s.employee_name_snapshot}</td>
        <td className="px-3 py-2">{s.section ?? '—'}</td>
        <td className="px-3 py-2 tabular-nums">{s.start_time ?? '—'}</td>
        <td className="px-3 py-2 tabular-nums">{s.end_time ?? '—'}</td>
        <td className="px-3 py-2 text-right tabular-nums">{s.break_minutes}m</td>
        <td className="px-3 py-2 text-center">{s.meal_provided ? '✓' : ''}</td>
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

  return (
    <tr>
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
      </td>
      <td className="px-3 py-2">
        <input
          className="input w-16"
          value={s.section ?? ''}
          maxLength={20}
          onChange={(e) => setField('section', e.target.value || null)}
          onBlur={() => commit({ section: s.section ?? null })}
        />
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
  name,
}: {
  id: string
  sheetId: string
  name: string
}) {
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Delete this shift for ${name}?`)) return
        startTransition(async () => {
          await deleteShift(id, sheetId)
        })
      }}
      className="text-xs text-rose-600 hover:text-rose-800 disabled:opacity-50 dark:text-rose-400"
    >
      {pending ? '…' : 'Delete'}
    </button>
  )
}
