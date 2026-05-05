import Link from 'next/link'
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase/server'
import { SetupRequired } from '@/app/_components/SetupRequired'
import { isoDate } from '@/lib/payroll'
import { summarizeDay } from '@/lib/payroll'
import { createDailySheet } from './actions'
import type { DailySheet, Shift } from '@/lib/types/db'

export const dynamic = 'force-dynamic'

type SheetWithShifts = DailySheet & { shifts: Shift[] }

export default async function ShiftsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto max-w-4xl">
        <h1 className="pb-6 text-2xl font-semibold tracking-tight">Daily shifts</h1>
        <SetupRequired />
      </div>
    )
  }

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('daily_sheets')
    .select('*, shifts (*)')
    .order('sheet_date', { ascending: false })
    .limit(60)
  if (error) throw new Error(error.message)
  const sheets = (data ?? []) as SheetWithShifts[]
  const today = isoDate(new Date())

  return (
    <div className="mx-auto max-w-4xl">
      <header className="pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Daily shifts</h1>
        <p className="mt-1 text-sm text-zinc-500">
          One sheet per calendar day. Pick a date to start a new sheet (or jump to an existing one).
        </p>
      </header>

      <section className="mb-8 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-3 text-sm font-medium">Open or create a day</h2>
        <form action={createDailySheet} className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-zinc-600 dark:text-zinc-400">Date</span>
            <input type="date" name="sheet_date" required defaultValue={today} className="input" />
          </label>
          <button className="btn-primary" type="submit">
            Open sheet
          </button>
        </form>
      </section>

      {sheets.length === 0 ? (
        <p className="text-sm text-zinc-500">No daily sheets yet. Open today’s above.</p>
      ) : (
        <SheetList sheets={sheets} />
      )}
    </div>
  )
}

function SheetList({ sheets }: { sheets: SheetWithShifts[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50">
          <tr>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium text-right">Shifts</th>
            <th className="px-4 py-3 font-medium text-right">Hours</th>
            <th className="px-4 py-3 font-medium text-right">Pay</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {sheets.map((s) => {
            const summary = summarizeDay(s.shifts)
            return (
              <tr key={s.id}>
                <td className="px-4 py-3 font-medium">
                  <Link href={`/shifts/${s.id}`} className="hover:underline">
                    {fmtDateLong(s.sheet_date)}
                  </Link>
                  {!s.pay_period_id && (
                    <span className="ml-2 text-xs text-amber-700 dark:text-amber-400">
                      no pay period
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={s.status} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{summary.shift_count}</td>
                <td className="px-4 py-3 text-right tabular-nums">{summary.total_hours.toFixed(2)}</td>
                <td className="px-4 py-3 text-right tabular-nums">${summary.total_pay.toFixed(2)}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/shifts/${s.id}`} className="text-xs text-zinc-500 hover:underline">
                    Open
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function StatusBadge({ status }: { status: DailySheet['status'] }) {
  const cls =
    status === 'approved'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
      : status === 'reviewing'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
      : 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${cls}`}>{status}</span>
}

function fmtDateLong(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
