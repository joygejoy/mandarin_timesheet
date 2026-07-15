import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase/server'
import { SetupRequired } from '@/app/_components/SetupRequired'
import { PageHero } from '@/app/_components/PageHero'
import { summarizePayPeriod, addDays, isoDate, daysInRange } from '@/lib/payroll'
import { getSession } from '@/lib/auth'
import { resolveDepartmentView } from '@/lib/department-view'
import type { Shift, AlcoholSale } from '@/lib/types/db'

export const dynamic = 'force-dynamic'

function getMondayOfWeek(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return isoDate(d)
}

function fmtShort(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

type DayRow = {
  id: string
  sheet_date: string
  status: string
  shifts: Shift[]
  alcohol_sales: AlcoholSale[]
}

export default async function WeekPage({
  params,
  searchParams,
}: {
  params: Promise<{ isoDate: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { isoDate: rawDate } = await params
  const monday = getMondayOfWeek(rawDate)
  const sunday = addDays(monday, 6)

  // Redirect non-Monday dates to their week's Monday
  if (monday !== rawDate) redirect(`/shifts/week/${monday}`)

  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHero eyebrow="Weekly · Summary" title="Weekly summary" accent="green" />
        <SetupRequired />
      </div>
    )
  }

  const { view } = await searchParams
  const session = await getSession()
  const departmentView = resolveDepartmentView(session?.department ?? 'all', view)

  const supabase = getSupabaseAdmin()
  let query = supabase
    .from('daily_sheets')
    .select('id, sheet_date, status, shifts(*), alcohol_sales(*)')
    .gte('sheet_date', monday)
    .lte('sheet_date', sunday)
    .order('sheet_date')
  if (departmentView !== 'all') {
    query = query.eq('department', departmentView)
  }
  const { data, error } = await query
  if (error) throw new Error(error.message)

  const sheets = (data ?? []) as DayRow[]
  const summary = summarizePayPeriod(sheets)
  const days = daysInRange(monday, sunday)
  const prevMonday = addDays(monday, -7)
  const nextMonday = addDays(monday, 7)
  const totalShifts = summary.rows.reduce((a, r) => a + r.shift_count, 0)

  return (
    <div className="mx-auto max-w-5xl">
      <PageHero
        eyebrow="Weekly · Summary"
        title={`${fmtShort(monday)} – ${fmtShort(sunday)}`}
        accent="green"
      />

      {/* Week navigation */}
      <div className="mb-6 flex items-center gap-3">
        <Link href={`/shifts/week/${prevMonday}`} className="btn-secondary text-sm">
          ← Prev week
        </Link>
        <Link href={`/shifts/week/${nextMonday}`} className="btn-secondary text-sm">
          Next week →
        </Link>
        <Link href="/payroll" className="ml-auto text-xs text-[color:var(--muted)] hover:underline">
          View pay periods →
        </Link>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Total hours" value={summary.total_hours.toFixed(1) + 'h'} />
        <SummaryCard label="Net pay" value={'$' + summary.total_pay.toFixed(2)} />
        <SummaryCard label="Employees" value={String(summary.rows.length)} />
        <SummaryCard label="Alcohol pts" value={String(summary.total_alcohol_points)} />
      </div>

      {/* Day status strip */}
      <section className="surface mb-6 p-4">
        <p className="eyebrow-green mb-3">Days this week</p>
        <div className="grid grid-cols-7 gap-1.5 text-center">
          {days.map((day) => {
            const sheet = sheets.find((s) => s.sheet_date === day)
            const d = new Date(day + 'T00:00:00')
            const dayName = d.toLocaleDateString(undefined, { weekday: 'short' })
            const dayNum = d.getDate()
            return (
              <div key={day}>
                <p className="text-[10px] text-[color:var(--muted)]">{dayName}</p>
                <p className="text-xs font-semibold">{dayNum}</p>
                {sheet ? (
                  <Link
                    href={`/shifts/${sheet.id}`}
                    className={
                      'mt-1 block rounded px-1 py-0.5 text-[10px] font-medium transition hover:opacity-75 ' +
                      (sheet.status === 'approved'
                        ? 'bg-[color:var(--tertiary-tint)] text-[color:var(--tertiary)]'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400')
                    }
                  >
                    {sheet.status}
                  </Link>
                ) : (
                  <span className="mt-1 block rounded bg-[color:var(--surface-raised,var(--border))] px-1 py-0.5 text-[10px] text-[color:var(--muted)]">
                    —
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* Per-employee table */}
      {summary.rows.length === 0 ? (
        <p className="surface border-dashed p-8 text-center text-sm text-[color:var(--muted)]">
          No shifts recorded for this week.
        </p>
      ) : (
        <section className="surface overflow-hidden">
          <p className="eyebrow-green border-b border-[color:var(--border)] p-4">Employee breakdown</p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-[color:var(--border)] text-left text-xs text-[color:var(--muted)]">
                <tr>
                  <th className="px-4 py-2.5 font-normal">Employee</th>
                  <th className="px-4 py-2.5 font-normal text-right">Shifts</th>
                  <th className="px-4 py-2.5 font-normal text-right">Hours</th>
                  <th className="px-4 py-2.5 font-normal text-right">Rate</th>
                  <th className="px-4 py-2.5 font-normal text-right">Gross</th>
                  <th className="px-4 py-2.5 font-normal text-right">Meals</th>
                  <th className="px-4 py-2.5 font-normal text-right">Net pay</th>
                  <th className="px-4 py-2.5 font-normal text-right">Alcohol pts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border)]">
                {summary.rows.map((row) => (
                  <tr key={row.employee_name} className="hover:bg-black/[0.015] dark:hover:bg-white/[0.015]">
                    <td className="px-4 py-2.5 font-medium">{row.employee_name}</td>
                    <td className="px-4 py-2.5 text-right text-[color:var(--muted)]">{row.shift_count}</td>
                    <td className="px-4 py-2.5 text-right">{row.total_hours.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right text-[color:var(--muted)]">${row.hourly_rate.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right">${row.gross_pay.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right text-[color:var(--muted)]">
                      {row.meal_count > 0 ? `-$${row.meal_deduction.toFixed(2)}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">${row.net_pay.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {row.alcohol_points > 0 ? row.alcohol_points : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-[color:var(--border)] text-sm font-semibold">
                <tr>
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right text-[color:var(--muted)]">{totalShifts}</td>
                  <td className="px-4 py-2.5 text-right">{summary.total_hours.toFixed(2)}</td>
                  <td className="px-4 py-2.5" />
                  <td className="px-4 py-2.5 text-right">${summary.total_gross_pay.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right text-[color:var(--muted)]">
                    {summary.total_meal_deduction > 0 ? `-$${summary.total_meal_deduction.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">${summary.total_pay.toFixed(2)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {summary.total_alcohol_points > 0 ? summary.total_alcohol_points : '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface p-4">
      <p className="text-xs text-[color:var(--muted)]">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}
