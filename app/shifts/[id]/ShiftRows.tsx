'use client'

import { useState, useTransition } from 'react'
import { updateShift, deleteShift, type ShiftPatchInput } from '../actions'
import { shiftPaidHours, shiftPay, formatMinutes, shiftPaidMinutes } from '@/lib/payroll'
import type { Shift, Employee } from '@/lib/types/db'

const OTHER = '__other__'

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
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50">
          <tr>
            <th className="px-3 py-3 font-medium">Employee</th>
            <th className="px-3 py-3 font-medium">Sect</th>
            <th className="px-3 py-3 font-medium">Start</th>
            <th className="px-3 py-3 font-medium">End</th>
            <th className="px-3 py-3 font-medium text-right">Break</th>
            <th className="px-3 py-3 font-medium text-center">Meal</th>
            <th className="px-3 py-3 font-medium text-right">Rate</th>
            <th className="px-3 py-3 font-medium text-right">Hours</th>
            <th className="px-3 py-3 font-medium text-right">Pay</th>
            <th className="px-3 py-3 font-medium">Notes</th>
            {!readOnly && <th className="px-3 py-3 font-medium" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
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

  function onEmployeeChange(id: string) {
    if (id === OTHER) {
      // keep current name + rate, just clear the linkage
      setField('employee_id', null)
      commit({ employee_id: null })
      return
    }
    const e = employees.find((x) => x.id === id)
    if (!e) return
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
  }

  const minutes = shiftPaidMinutes(s)
  const hours = shiftPaidHours(s)
  const pay = shiftPay(s)
  const incomplete = !s.start_time || !s.end_time

  if (readOnly) {
    return (
      <tr className="bg-emerald-50/40 dark:bg-emerald-950/20">
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
        <td className="px-3 py-2 text-right tabular-nums">{incomplete ? '—' : `$${pay.toFixed(2)}`}</td>
        <td className="px-3 py-2 text-zinc-500">{s.notes ?? ''}</td>
      </tr>
    )
  }

  return (
    <tr>
      <td className="px-3 py-2">
        <select
          value={s.employee_id ?? OTHER}
          onChange={(e) => onEmployeeChange(e.target.value)}
          disabled={pending}
          className="input"
        >
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name}
            </option>
          ))}
          <option value={OTHER}>{s.employee_id ? '— Other —' : `(unlinked) ${s.employee_name_snapshot}`}</option>
        </select>
        {!s.employee_id && (
          <input
            className="input mt-1 text-xs"
            value={s.employee_name_snapshot}
            onChange={(e) => setField('employee_name_snapshot', e.target.value)}
            onBlur={() => commit({ employee_name_snapshot: s.employee_name_snapshot })}
          />
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
        {incomplete ? <span className="text-zinc-400">—</span> : hours.toFixed(2)}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {incomplete ? <span className="text-zinc-400">—</span> : `$${pay.toFixed(2)}`}
        {minutes > 0 && (
          <div className="text-[10px] text-zinc-400">{formatMinutes(minutes)}</div>
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
        {pending && <p className="mt-1 text-[10px] text-zinc-400">saving…</p>}
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
