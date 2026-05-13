'use client'

import { useRef, useState, useTransition } from 'react'
import { EmployeeCombobox } from '@/app/_components/EmployeeCombobox'
import { DEFAULT_WAGE_RATE } from '@/lib/wages'
import type { Employee } from '@/lib/types/db'

export function AddShiftForm({
  dailySheetId,
  employees,
  addShift,
}: {
  dailySheetId: string
  employees: Employee[]
  addShift: (formData: FormData) => Promise<void>
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [employeeId, setEmployeeId] = useState<string | null>(employees[0]?.id ?? null)
  const [name, setName] = useState<string>(employees[0]?.full_name ?? '')
  const [rate, setRate] = useState<number>(employees[0]?.hourly_rate ?? DEFAULT_WAGE_RATE)
  const [role, setRole] = useState<string>(employees[0]?.role ?? '')
  const [breakMin, setBreakMin] = useState<number>(employees[0]?.default_break_minutes ?? 0)
  const [meal, setMeal] = useState<boolean>(employees[0]?.default_meal_provided ?? false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function onSelectEmployee(picked: { id: string | null; label: string }) {
    if (picked.id) {
      const e = employees.find((x) => x.id === picked.id)
      if (e) {
        setEmployeeId(e.id)
        setName(e.full_name)
        setRate(e.hourly_rate)
        setRole(e.role ?? '')
        setBreakMin(e.default_break_minutes)
        setMeal(e.default_meal_provided)
        return
      }
    }
    // Custom typed name
    setEmployeeId(null)
    setName(picked.label)
    setRate(DEFAULT_WAGE_RATE)
    setRole('')
    setBreakMin(0)
    setMeal(false)
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    // Replace the select with the resolved id (or null) and inject snapshot fields.
    fd.set('daily_sheet_id', dailySheetId)
    fd.set('employee_id', employeeId ?? '')
    fd.set('employee_name', name)
    fd.set('hourly_rate', rate.toString())
    if (meal) fd.set('meal_provided', 'on')
    else fd.delete('meal_provided')

    startTransition(async () => {
      try {
        await addShift(fd)
        // Reset times/section/notes only; keep employee selection for repeated entries.
        const f = formRef.current
        if (f) {
          ;(f.elements.namedItem('start_time') as HTMLInputElement).value = ''
          ;(f.elements.namedItem('end_time') as HTMLInputElement).value = ''
          ;(f.elements.namedItem('section') as HTMLInputElement).value = ''
          ;(f.elements.namedItem('notes') as HTMLInputElement).value = ''
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add shift')
      }
    })
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="surface p-4"
    >
      <div className="grid gap-3 sm:grid-cols-6">
        <div className="sm:col-span-2">
          <label className="block text-xs text-[color:var(--muted)]">Employee</label>
          <div className="mt-1">
            <EmployeeCombobox
              options={employees.map((e) => ({
                id: e.id,
                label: e.full_name,
                sublabel: e.role ?? undefined,
              }))}
              value={employeeId}
              customLabel={name}
              onChange={onSelectEmployee}
            />
          </div>
          {!employeeId && name && (
            <p className="mt-1 text-[10px] text-[color:var(--muted)]">unlinked from roster</p>
          )}
        </div>

        <div>
          <label className="block text-xs text-[color:var(--muted)]">Section</label>
          <input name="section" className="input mt-1" maxLength={20} placeholder="A" />
        </div>

        <div>
          <label className="block text-xs text-[color:var(--muted)]">Role</label>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="input mt-1"
            maxLength={60}
          />
        </div>

        <div>
          <label className="block text-xs text-[color:var(--muted)]">Start (HH:MM)</label>
          <input
            name="start_time"
            type="time"
            className="input mt-1"
            placeholder="16:30"
          />
        </div>
        <div>
          <label className="block text-xs text-[color:var(--muted)]">End (HH:MM)</label>
          <input name="end_time" type="time" className="input mt-1" placeholder="22:00" />
        </div>
        <div>
          <label className="block text-xs text-[color:var(--muted)]">Break (min)</label>
          <input
            type="number"
            min="0"
            value={breakMin}
            onChange={(e) => setBreakMin(Number(e.target.value))}
            className="input mt-1"
          />
        </div>
        <div>
          <label className="block text-xs text-[color:var(--muted)]">Rate ($)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={rate}
            onChange={(e) => setRate(Number(e.target.value))}
            className="input mt-1"
          />
        </div>
        <div className="flex items-end">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={meal}
              onChange={(e) => setMeal(e.target.checked)}
            />
            Meal
          </label>
        </div>

        <div className="sm:col-span-4">
          <label className="block text-xs text-[color:var(--muted)]">Notes</label>
          <input name="notes" className="input mt-1" maxLength={500} />
        </div>

        <div className="flex items-end justify-end sm:col-span-2">
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? 'Adding…' : 'Add shift'}
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>
      )}
    </form>
  )
}
