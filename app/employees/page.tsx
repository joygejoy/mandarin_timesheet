import Link from 'next/link'
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase/server'
import { SetupRequired } from '@/app/_components/SetupRequired'
import { PageHero } from '@/app/_components/PageHero'
import { EmployeesClient } from './EmployeesClient'
import type { Employee } from '@/lib/types/db'

export const dynamic = 'force-dynamic'

export default async function EmployeesPage() {
  const configured = isSupabaseConfigured()

  return (
    <div className="mx-auto max-w-5xl">
      <PageHero
        eyebrow="Setup · Roster"
        title="Employees"
        subtitle="Default rate is Ontario minimum wage ($17.60). Inactive employees stay in past payroll snapshots; deleted ones do too — their shifts keep the name."
        accent="green"
        action={
          configured ? (
            <>
              <Link href="/employees/import" className="btn-secondary">
                Import from sheet
              </Link>
              <Link href="/employees/new" className="btn-primary">
                + Add employee
              </Link>
            </>
          ) : null
        }
      />

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
    <div className="surface border-l-4 border-l-[color:var(--primary)] p-4 text-sm">
      <p className="eyebrow mb-1">Error</p>
      <p className="font-medium">Could not load employees</p>
      <p className="mt-1 font-mono text-xs text-[color:var(--muted)]">{message}</p>
      <p className="mt-2 text-xs text-[color:var(--muted)]">
        Check that <code>.env.local</code> is set and the Supabase migration{' '}
        <code>supabase/migrations/0001_init.sql</code> has been applied.
      </p>
    </div>
  )
}
