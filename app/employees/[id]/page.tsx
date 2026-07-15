import { notFound } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { getSession } from '@/lib/auth'
import { PageHero } from '@/app/_components/PageHero'
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
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) notFound()

  const employee = data as Employee
  const action = updateEmployee.bind(null, employee.id)
  const session = await getSession()
  const lockedDepartment = session && session.department !== 'all' ? session.department : null

  return (
    <div className="mx-auto max-w-2xl">
      <PageHero
        eyebrow="Employees · Edit"
        title={employee.full_name}
        accent="green"
        backLink={{ href: '/employees', label: 'Employees' }}
      />
      <EmployeeForm
        action={action}
        employee={employee}
        submitLabel="Save changes"
        lockedDepartment={lockedDepartment}
      />
    </div>
  )
}
