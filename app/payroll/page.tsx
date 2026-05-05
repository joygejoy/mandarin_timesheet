import Link from 'next/link'
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase/server'
import { SetupRequired } from '@/app/_components/SetupRequired'
import { suggestNextPeriod } from '@/lib/payroll'
import { createPayPeriod } from './actions'
import type { PayPeriod } from '@/lib/types/db'

export const dynamic = 'force-dynamic'

export default async function PayrollPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto max-w-4xl">
        <h1 className="pb-6 text-2xl font-semibold tracking-tight">Payroll</h1>
        <SetupRequired />
      </div>
    )
  }

  const supabase = getSupabaseAdmin()
  const { data: periods } = await supabase
    .from('pay_periods')
    .select('*')
    .order('start_date', { ascending: false })

  const lastEnd = periods?.[0]?.end_date ?? null
  const next = suggestNextPeriod(lastEnd)

  return (
    <div className="mx-auto max-w-4xl">
      <header className="pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Payroll</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Each pay period is two weeks. Add daily sheets inside a period; close it when ready to export.
        </p>
      </header>

      <section className="mb-8 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 text-sm font-medium">Start a new pay period</h2>
        <form action={createPayPeriod} className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600 dark:text-zinc-400">Start</span>
            <input type="date" name="start_date" required defaultValue={next.start} className="input" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600 dark:text-zinc-400">End</span>
            <input type="date" name="end_date" required defaultValue={next.end} className="input" />
          </label>
          <button className="btn-primary" type="submit">
            Create period
          </button>
        </form>
      </section>

      {!periods || periods.length === 0 ? (
        <p className="text-sm text-zinc-500">No pay periods yet.</p>
      ) : (
        <PeriodList rows={periods as PayPeriod[]} />
      )}
    </div>
  )
}

function PeriodList({ rows }: { rows: PayPeriod[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50">
          <tr>
            <th className="px-4 py-3 font-medium">Period</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-3 font-medium">
                <Link href={`/payroll/${p.id}`} className="hover:underline">
                  {fmtRange(p.start_date, p.end_date)}
                </Link>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={p.status} />
              </td>
              <td className="px-4 py-3 text-right">
                <Link href={`/payroll/${p.id}`} className="text-xs text-zinc-500 hover:underline">
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatusBadge({ status }: { status: PayPeriod['status'] }) {
  const cls =
    status === 'open'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
      : status === 'closed'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
      : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${cls}`}>{status}</span>
}

function fmtRange(start: string, end: string) {
  return `${fmtDate(start)} → ${fmtDate(end)}`
}

function fmtDate(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
