import { createEmployee } from '../actions'
import { EmployeeForm } from '../EmployeeForm'
import { PageHero } from '@/app/_components/PageHero'
import { getSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function NewEmployeePage() {
  const session = await getSession()
  const lockedDepartment = session && session.department !== 'all' ? session.department : null

  return (
    <div className="mx-auto max-w-2xl">
      <PageHero
        eyebrow="Employees · New"
        title="Add employee"
        accent="green"
        backLink={{ href: '/employees', label: 'Employees' }}
      />
      <EmployeeForm action={createEmployee} submitLabel="Create employee" lockedDepartment={lockedDepartment} />
    </div>
  )
}
