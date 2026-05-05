import Link from 'next/link'
import { createEmployee } from '../actions'
import { EmployeeForm } from '../EmployeeForm'

export default function NewEmployeePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <header className="pb-6">
        <Link href="/employees" className="text-sm text-zinc-500 hover:underline">
          ← Employees
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Add employee</h1>
      </header>
      <EmployeeForm action={createEmployee} submitLabel="Create employee" />
    </div>
  )
}
