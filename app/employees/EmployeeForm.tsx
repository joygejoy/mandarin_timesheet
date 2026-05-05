import type { Employee } from '@/lib/types/db'

type Props = {
  action: (formData: FormData) => void | Promise<void>
  employee?: Employee
  submitLabel: string
}

export function EmployeeForm({ action, employee, submitLabel }: Props) {
  const e = employee
  return (
    <form action={action} className="grid max-w-xl gap-4">
      <Field label="Full name" required>
        <input
          name="full_name"
          required
          defaultValue={e?.full_name ?? ''}
          className="input"
          autoComplete="off"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Role">
          <input name="role" defaultValue={e?.role ?? ''} className="input" />
        </Field>
        <Field label="Hourly rate ($)" required>
          <input
            name="hourly_rate"
            type="number"
            step="0.01"
            min="0"
            required
            defaultValue={e?.hourly_rate ?? 17.5}
            className="input"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Age">
          <input
            name="age"
            type="number"
            min="0"
            defaultValue={e?.age ?? ''}
            className="input"
          />
        </Field>
        <Field label="Default break (min)">
          <input
            name="default_break_minutes"
            type="number"
            min="0"
            defaultValue={e?.default_break_minutes ?? 0}
            className="input"
          />
        </Field>
      </div>

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
      <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </span>
      {children}
    </label>
  )
}
