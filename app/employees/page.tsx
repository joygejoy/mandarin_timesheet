import Link from 'next/link'
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase/server'
import { SetupRequired } from '@/app/_components/SetupRequired'
import { deleteEmployee, toggleEmployeeActive } from './actions'
import { DeleteButton } from './DeleteButton'
import type { Employee } from '@/lib/types/db'

export const dynamic = 'force-dynamic'

export default async function EmployeesPage() {
  const configured = isSupabaseConfigured()

  return (
    <div className="mx-auto max-w-5xl">
      <header className="flex items-end justify-between pb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Employees</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Default rate is $17.50. Inactive employees stay in past payroll snapshots; deleted ones do too (their shifts keep the name).
          </p>
        </div>
        {configured && (
          <div className="flex gap-2">
            <Link href="/employees/import" className="btn-secondary">
              Import from sheet
            </Link>
            <Link href="/employees/new" className="btn-primary">
              Add employee
            </Link>
          </div>
        )}
      </header>

      {!configured ? <SetupRequired /> : <EmployeeList />}
    </div>
  )
}

async function EmployeeList() {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .order('active', { ascending: false })
    .order('full_name', { ascending: true })

  if (error) return <ErrorBox message={error.message} />
  if (!data || data.length === 0) return <EmptyState />
  return <EmployeeTable rows={data as Employee[]} />
}

function EmployeeTable({ rows }: { rows: Employee[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50">
          <tr>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Role</th>
            <th className="px-4 py-3 font-medium text-right">Rate</th>
            <th className="px-4 py-3 font-medium text-right">Age</th>
            <th className="px-4 py-3 font-medium text-right">Break</th>
            <th className="px-4 py-3 font-medium">Meal</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((r) => (
            <tr key={r.id} className={r.active ? '' : 'opacity-50'}>
              <td className="px-4 py-3 font-medium">
                <Link href={`/employees/${r.id}`} className="hover:underline">
                  {r.full_name}
                </Link>
              </td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{r.role ?? '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums">${r.hourly_rate.toFixed(2)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{r.age ?? '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {r.default_break_minutes}m
              </td>
              <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                {r.default_meal_provided ? 'Yes' : 'No'}
              </td>
              <td className="px-4 py-3">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                    r.active
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                  }`}
                >
                  {r.active ? 'Active' : 'Inactive'}
                </span>
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex justify-end gap-3">
                  <ToggleActiveForm id={r.id} active={r.active} />
                  <DeleteForm id={r.id} name={r.full_name} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ToggleActiveForm({ id, active }: { id: string; active: boolean }) {
  async function action() {
    'use server'
    await toggleEmployeeActive(id, !active)
  }
  return (
    <form action={action}>
      <button type="submit" className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
        {active ? 'Deactivate' : 'Reactivate'}
      </button>
    </form>
  )
}

function DeleteForm({ id, name }: { id: string; name: string }) {
  async function action() {
    'use server'
    await deleteEmployee(id)
  }
  return <DeleteButton action={action} name={name} />
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <p className="text-sm text-zinc-500">No employees yet.</p>
      <Link href="/employees/new" className="btn-primary mt-4 inline-flex">
        Add the first one
      </Link>
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
      <p className="font-medium">Could not load employees</p>
      <p className="mt-1 font-mono text-xs">{message}</p>
      <p className="mt-2 text-xs">
        Check that <code>.env.local</code> is set and the Supabase migration{' '}
        <code>supabase/migrations/0001_init.sql</code> has been applied.
      </p>
    </div>
  )
}
