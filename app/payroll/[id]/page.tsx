import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { summarizePayPeriod, daysInRange } from '@/lib/payroll'
import { ClosePeriodForm } from './ClosePeriodForm'
import type { PayPeriod, DailySheet, Shift, AlcoholSale } from '@/lib/types/db'

export const dynamic = 'force-dynamic'

type SheetWithChildren = DailySheet & { shifts: Shift[]; alcohol_sales: AlcoholSale[] }

export default async function PayPeriodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = getSupabaseAdmin()

  const [{ data: periodRow, error: periodErr }, { data: sheetsRow }] = await Promise.all([
    supabase.from('pay_periods').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('daily_sheets')
      .select('*, shifts (*), alcohol_sales (*)')
      .eq('pay_period_id', id)
      .order('sheet_date', { ascending: true }),
  ])
  if (periodErr) throw new Error(periodErr.message)
  if (!periodRow) notFound()

  const period = periodRow as PayPeriod
  const sheets = (sheetsRow ?? []) as SheetWithChildren[]
  const approved = sheets.filter((s) => s.status === 'approved')
  const drafts = sheets.filter((s) => s.status !== 'approved')

  const summary = summarizePayPeriod(
    approved.map((s) => ({
      sheet_date: s.sheet_date,
      shifts: s.shifts,
      alcohol_sales: s.alcohol_sales,
    }))
  )

  const allDates = daysInRange(period.start_date, period.end_date)
  const approvedDates = new Set(approved.map((s) => s.sheet_date))
  const draftDates = new Set(drafts.map((s) => s.sheet_date))

  return (
    <div className="mx-auto max-w-6xl">
      <header className="pb-6">
        <Link href="/payroll" className="text-sm text-zinc-500 hover:underline">
          ← Payroll
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{fmtRange(period.start_date, period.end_date)}</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Status: <span className="font-medium">{period.status}</span> ·{' '}
              {approved.length} approved / {sheets.length} sheet{sheets.length === 1 ? '' : 's'}
              {drafts.length > 0 && (
                <>
                  {' · '}
                  <span className="text-amber-700 dark:text-amber-400">
                    {drafts.length} draft{drafts.length === 1 ? '' : 's'} pending
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href={`/api/payroll/${id}/csv`}
              className="btn-secondary"
              download={`payroll_${period.start_date}_${period.end_date}.csv`}
            >
              Download CSV
            </a>
            <ClosePeriodForm id={id} status={period.status} />
          </div>
        </div>
      </header>

      <SummaryCards
        totalHours={summary.total_hours}
        totalPay={summary.total_pay}
        employees={summary.rows.length}
        alcoholPoints={summary.total_alcohol_points}
      />

      <Calendar
        dates={allDates}
        approved={approvedDates}
        drafts={draftDates}
        sheets={sheets}
      />

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Per-employee summary (approved sheets only)
        </h2>
        {summary.rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
            {drafts.length > 0
              ? 'Approve at least one daily sheet to see payroll totals.'
              : 'No approved sheets in this period yet.'}
          </p>
        ) : (
          <PerEmployeeTable summary={summary} />
        )}
      </section>
    </div>
  )
}

function SummaryCards({
  totalHours,
  totalPay,
  employees,
  alcoholPoints,
}: {
  totalHours: number
  totalPay: number
  employees: number
  alcoholPoints: number
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card label="Total hours" value={totalHours.toFixed(2)} />
      <Card label="Total gross pay" value={`$${totalPay.toFixed(2)}`} />
      <Card label="Employees on payroll" value={employees.toString()} />
      <Card label="Alcohol points" value={alcoholPoints.toString()} />
    </div>
  )
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function Calendar({
  dates,
  approved,
  drafts,
  sheets,
}: {
  dates: string[]
  approved: Set<string>
  drafts: Set<string>
  sheets: SheetWithChildren[]
}) {
  const sheetByDate = new Map(sheets.map((s) => [s.sheet_date, s]))
  return (
    <section className="mt-6">
      <h2 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">Days in this period</h2>
      <div className="flex flex-wrap gap-2">
        {dates.map((d) => {
          const sheet = sheetByDate.get(d)
          const isApproved = approved.has(d)
          const isDraft = drafts.has(d)
          const cls = isApproved
            ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
            : isDraft
            ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
            : 'border-zinc-200 bg-white text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500'
          const label = (
            <span className="block text-center">
              <span className="block text-[10px] uppercase tracking-wide opacity-70">
                {fmtWeekday(d)}
              </span>
              <span className="block text-sm font-medium tabular-nums">{fmtDayMonth(d)}</span>
            </span>
          )
          return sheet ? (
            <Link
              key={d}
              href={`/shifts/${sheet.id}`}
              className={`min-w-16 rounded-md border px-3 py-2 transition hover:border-zinc-500 ${cls}`}
            >
              {label}
            </Link>
          ) : (
            <span
              key={d}
              className={`min-w-16 rounded-md border border-dashed px-3 py-2 ${cls}`}
              title="No sheet for this day"
            >
              {label}
            </span>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Green = approved · Amber = draft · Empty = no sheet yet
      </p>
    </section>
  )
}

function PerEmployeeTable({
  summary,
}: {
  summary: ReturnType<typeof summarizePayPeriod>
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <table className="min-w-full text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50">
          <tr>
            <th className="px-4 py-3 font-medium">Employee</th>
            <th className="px-4 py-3 font-medium text-right">Rate</th>
            <th className="px-4 py-3 font-medium text-right">Shifts</th>
            <th className="px-4 py-3 font-medium text-right">Hours</th>
            <th className="px-4 py-3 font-medium text-right">Gross pay</th>
            <th className="px-4 py-3 font-medium text-right">Alcohol pts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {summary.rows.map((r) => (
            <tr key={r.employee_id ?? `__${r.employee_name}`}>
              <td className="px-4 py-3 font-medium">{r.employee_name}</td>
              <td className="px-4 py-3 text-right tabular-nums">${r.hourly_rate.toFixed(2)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{r.shift_count}</td>
              <td className="px-4 py-3 text-right tabular-nums">{r.total_hours.toFixed(2)}</td>
              <td className="px-4 py-3 text-right tabular-nums">${r.gross_pay.toFixed(2)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{r.alcohol_points}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-zinc-50 dark:bg-zinc-800/50">
          <tr>
            <td className="px-4 py-3 text-xs uppercase tracking-wide text-zinc-500">Total</td>
            <td className="px-4 py-3" />
            <td className="px-4 py-3" />
            <td className="px-4 py-3 text-right font-semibold tabular-nums">
              {summary.total_hours.toFixed(2)}
            </td>
            <td className="px-4 py-3 text-right font-semibold tabular-nums">
              ${summary.total_pay.toFixed(2)}
            </td>
            <td className="px-4 py-3 text-right font-semibold tabular-nums">
              {summary.total_alcohol_points}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function fmtRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  const fmt = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString(undefined, opts)
  return `${fmt(start)} → ${fmt(end)}`
}

function fmtWeekday(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' })
}

function fmtDayMonth(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
