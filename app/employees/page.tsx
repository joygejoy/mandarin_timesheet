import Link from 'next/link'
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase/server'
import { SetupRequired } from '@/app/_components/SetupRequired'
import { EmployeesClient } from './EmployeesClient'
import type { Employee } from '@/lib/types/db'

export const dynamic = 'force-dynamic'

export default async function EmployeesPage() {
  const configured = isSupabaseConfigured()

  return (
    <div className="mx-auto max-w-5xl">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Employees</h1>
          <p className="mt-1 text-sm text-[color:var(--muted)]">
            Default rate is Ontario minimum wage ($17.60). Inactive employees stay in past
            payroll snapshots; deleted ones do too — their shifts keep the name.
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

      {!configured ? <SetupRequired /> : <EmployeeListLoader />}
    </div>
  )
}

async function EmployeeListLoader() {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .order('full_name', { ascending: true })

  if (error) return <ErrorBox message={error.message} />
  return <EmployeesClient employees={(data ?? []) as Employee[]} />
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
      <p className="font-medium">Could not load employees</p>
      <p className="mt-1 font-mono text-xs">{message}</p>
      <p className="mt-2 text-xs">
        Check that <code>.env.local</code> is set and the Supabase migration{' '}
        <code>supabase/migrations/0001_init.sql</code> has been applied.
      </p>
    </div>
  )
}
