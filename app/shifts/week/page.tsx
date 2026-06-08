import { redirect } from 'next/navigation'
import { isoDate } from '@/lib/payroll'

function getMondayOfWeek(d: Date): string {
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return isoDate(d)
}

export default function WeekIndexPage() {
  redirect(`/shifts/week/${getMondayOfWeek(new Date())}`)
}
