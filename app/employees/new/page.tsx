import { createEmployee } from '../actions'
import { EmployeeForm } from '../EmployeeForm'
import { PageHero } from '@/app/_components/PageHero'

export default function NewEmployeePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHero
        eyebrow="Employees · New"
        title="Add employee"
        accent="green"
        backLink={{ href: '/employees', label: 'Employees' }}
      />
      <EmployeeForm action={createEmployee} submitLabel="Create employee" />
    </div>
  )
}
