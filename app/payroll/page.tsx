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
      <header className="pb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Payroll</h1>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          Each pay period is two weeks. Add daily sheets inside a period; close it when ready to export.
        </p>
      </header>

      <section className="surface mb-8 p-4">
        <form action={createPayPeriod} className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[color:var(--muted)]">Start</span>
            <input type="date" name="start_date" required defaultValue={next.start} className="input" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[color:var(--muted)]">End</span>
            <input type="date" name="end_date" required defaultValue={next.end} className="input" />
          </label>
          <button className="btn-primary" type="submit">
            Create period
          </button>
        </form>
      </section>

      {!periods || periods.length === 0 ? (
        <p className="text-sm text-[color:var(--muted)]">No pay periods yet.</p>
      ) : (
        <PeriodList rows={periods as PayPeriod[]} />
      )}
    </div>
  )
}

function PeriodList({ rows }: { rows: PayPeriod[] }) {
  return (
    <div className="surface overflow-hidden">
      <table className="min-w-full text-sm">
        <thead className="border-b border-[color:var(--border)] text-left text-xs font-normal text-[color:var(--muted)]">
          <tr>
            <th className="px-3 py-2.5 font-normal">Period</th>
            <th className="px-3 py-2.5 font-normal">Status</th>
            <th className="px-3 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--border)]">
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="px-3 py-2.5 font-medium">
                <Link href={`/payroll/${p.id}`} className="link-soft">
                  {fmtRange(p.start_date, p.end_date)}
                </Link>
              </td>
              <td className="px-3 py-2.5">
                <StatusDot status={p.status} />
              </td>
              <td className="px-3 py-2.5 text-right">
                <Link href={`/payroll/${p.id}`} className="text-xs text-[color:var(--muted)] hover:text-[color:var(--foreground)]">
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

function StatusDot({ status }: { status: PayPeriod['status'] }) {
  const color =
    status === 'open'
      ? 'bg-[color:var(--success)]'
      : status === 'closed'
      ? 'bg-zinc-400 dark:bg-zinc-600'
      : 'bg-[color:var(--accent)]'
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[color:var(--muted)]">
      <span className={`dot ${color}`} aria-hidden />
      {status}
    </span>
  )
}

function fmtRange(start: string, end: string) {
  return `${fmtDate(start)} → ${fmtDate(end)}`
}

function fmtDate(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
