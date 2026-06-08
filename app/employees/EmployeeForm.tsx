'use client'

import { useState } from 'react'
import { WageSelect } from '@/app/_components/WageSelect'
import { DEFAULT_WAGE_RATE } from '@/lib/wages'
import type { Employee } from '@/lib/types/db'

type Props = {
  action: (formData: FormData) => void | Promise<void>
  employee?: Employee
  submitLabel: string
}

export function EmployeeForm({ action, employee, submitLabel }: Props) {
  const e = employee
  const [rate, setRate] = useState<number>(e?.hourly_rate ?? DEFAULT_WAGE_RATE)

  return (
    <form action={action} className="grid max-w-xl gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Full name" required>
          <input
            name="full_name"
            required
            defaultValue={e?.full_name ?? ''}
            className="input"
            autoComplete="off"
          />
        </Field>
        <Field label="Employee #" required>
          <input
            name="employee_number"
            type="number"
            min="1"
            required
            defaultValue={e?.employee_number ?? ''}
            className="input tabular-nums"
            placeholder="e.g. 758"
          />
        </Field>
      </div>

      <Field label="Role">
        <select name="role" defaultValue={e?.role ?? ''} className="input">
          <option value="">—</option>
          <option value="Server">Server</option>
          <option value="Busperson">Busperson</option>
          {e?.role && e.role !== 'Server' && e.role !== 'Busperson' && (
            <option value={e.role}>{e.role}</option>
          )}
        </select>
      </Field>

      <Field label="Hourly rate" required>
        <div className="flex items-center gap-2">
          <WageSelect
            rate={rate}
            onChange={({ rate: next }) => setRate(next)}
            className="max-w-[16rem]"
          />
          <div className="inline-flex items-center gap-1">
            <span className="text-[color:var(--muted)]">$</span>
            <input
              name="hourly_rate"
              type="number"
              step="0.01"
              min="0"
              required
              value={rate.toFixed(2)}
              onChange={(ev) => setRate(Number(ev.target.value))}
              className="input w-24 text-right tabular-nums"
            />
          </div>
        </div>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          Ontario minimum wage $17.60 · student wage $16.60. Pick Custom to enter any other rate.
        </p>
      </Field>

      <Field label="Age">
        <input
          name="age"
          type="number"
          min="0"
          defaultValue={e?.age ?? ''}
          className="input"
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="default_meal_provided"
          defaultChecked={e?.default_meal_provided ?? false}
        />
        Meal provided by default
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={e?.active ?? true} />
        Active
      </label>

      <Field label="Notes">
        <textarea
          name="notes"
          rows={3}
          defaultValue={e?.notes ?? ''}
          className="input"
        />
      </Field>

      <div className="flex gap-3 pt-2">
        <button type="submit" className="btn-primary">
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[color:var(--muted)]">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      {children}
    </label>
  )
}
