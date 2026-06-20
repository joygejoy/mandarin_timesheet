import Link from 'next/link'
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase/server'
import { SetupRequired } from '@/app/_components/SetupRequired'
import { PageHero } from '@/app/_components/PageHero'
import { suggestNextPeriod } from '@/lib/payroll'
import { createPayPeriod } from './actions'
import type { PayPeriod } from '@/lib/types/db'

export const dynamic = 'force-dynamic'

export default async function PayrollPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHero
          eyebrow="Payroll · Periods"
          title="Payroll"
          accent="green"
        />
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
      <PageHero
        eyebrow="Payroll · Periods"
        title="Biweekly payroll"
        subtitle="Each pay period is two weeks. Add daily sheets inside a period; close it when ready to export."
        accent="green"
      />

      <section className="surface mb-8 p-5">
        <p className="eyebrow-green mb-3">New period</p>
        <form action={createPayPeriod} className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[color:var(--muted)]">Start</span>
            <input type="date" name="start_date" required defaultValue={next.start} className="input" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[color:var(--muted)]">End</span>
            <input type="date" name="end_date" required defaultValue={next.end} className="input" />
          </label>
          <button className="btn-tertiary" type="submit">
            Create period
          </button>
        </form>
      </section>

      {!periods || periods.length === 0 ? (
        <p className="surface border-dashed p-8 text-center text-sm text-[color:var(--muted)]">
          No pay periods yet. Use the form above to create your first one.
        </p>
      ) : (
        <PeriodList rows={periods as PayPeriod[]} />
      )}
    </div>
  )
}

function PeriodList({ rows }: { rows: PayPeriod[] }) {
  return (
    <section>
      <h2 className="eyebrow-green mb-3">All periods</h2>
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
              <tr key={p.id} className="relative cursor-pointer hover:bg-black/5 dark:hover:bg-white/5">
                <td className="px-3 py-2.5 font-medium">
                  {/* after:absolute after:inset-0 makes this link cover the entire row */}
                  <Link
                    href={`/payroll/${p.id}`}
                    className="font-medium after:absolute after:inset-0 after:content-['']"
                  >
                    {fmtRange(p.start_date, p.end_date)}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <StatusDot status={p.status} />
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="btn-ghost pointer-events-none text-xs">Open →</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function StatusDot({ status }: { status: PayPeriod['status'] }) {
  const color =
    status === 'open'
      ? 'bg-[color:var(--tertiary)]'
      : status === 'closed'
      ? 'bg-zinc-400 dark:bg-zinc-600'
      : 'bg-[color:var(--primary)]'
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[color:var(--muted)]">
      <span className={`dot ${color}`} aria-hidden="true" />
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
