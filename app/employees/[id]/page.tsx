import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSupabaseServer } from '@/lib/supabase/server'
import { updateEmployee } from '../actions'
import { EmployeeForm } from '../EmployeeForm'
import type { Employee } from '@/lib/types/db'

export const dynamic = 'force-dynamic'

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await getSupabaseServer()
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) notFound()

  const employee = data as Employee
  const action = updateEmployee.bind(null, employee.id)

  return (
    <div className="mx-auto max-w-2xl">
      <header className="pb-6">
        <Link href="/employees" className="text-sm text-zinc-500 hover:underline">
          ← Employees
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{employee.full_name}</h1>
      </header>
      <EmployeeForm action={action} employee={employee} submitLabel="Save changes" />
    </div>
  )
}
