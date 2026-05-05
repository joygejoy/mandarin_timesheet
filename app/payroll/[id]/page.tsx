import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import type { PayPeriod } from '@/lib/types/db'

export const dynamic = 'force-dynamic'

export default async function PayPeriodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('pay_periods')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) notFound()

  const period = data as PayPeriod

  return (
    <div className="mx-auto max-w-4xl">
      <header className="pb-6">
        <Link href="/payroll" className="text-sm text-zinc-500 hover:underline">
          ← Payroll
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {fmtRange(period.start_date, period.end_date)}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">Status: {period.status}</p>
      </header>

      <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">
          Daily sheets and biweekly rollup are coming next.
        </p>
        <p className="mt-2">
          For now, add daily sheets at <Link href="/shifts" className="underline">Daily shifts</Link>{' '}
          and roll up here once that's built.
        </p>
      </div>
    </div>
  )
}

function fmtRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  const fmt = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString(undefined, opts)
  return `${fmt(start)} → ${fmt(end)}`
}
