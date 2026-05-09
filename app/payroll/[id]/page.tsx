import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { summarizePayPeriod, daysInRange } from '@/lib/payroll'
import { PageHero } from '@/app/_components/PageHero'
import { ClosePeriodForm } from './ClosePeriodForm'
import { PushToSheetsButton } from './PushToSheetsButton'
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
      <PageHero
        eyebrow={`Pay period · ${period.status}`}
        title={fmtRange(period.start_date, period.end_date)}
        subtitle={
          <>
            <span className="font-medium text-[color:var(--foreground)] tabular-nums">
              {approved.length}
            </span>{' '}
            approved of{' '}
            <span className="tabular-nums">{sheets.length}</span> sheet
            {sheets.length === 1 ? '' : 's'}
            {drafts.length > 0 && (
              <>
                {' · '}
                <span className="font-medium text-[color:var(--primary)] tabular-nums">
                  {drafts.length}
                </span>{' '}
                draft{drafts.length === 1 ? '' : 's'} pending
              </>
            )}
          </>
        }
        accent="green"
        backLink={{ href: '/payroll', label: 'Payroll' }}
        action={
          <>
            <a
              href={`/api/payroll/${id}/csv`}
              className="btn-secondary"
              download={`payroll_${period.start_date}_${period.end_date}.csv`}
            >
              CSV
            </a>
            <a
              href={`/api/payroll/${id}/pdf`}
              className="btn-secondary"
              download={`payroll_${period.start_date}_${period.end_date}.pdf`}
            >
              PDF
            </a>
            <PushToSheetsButton periodId={id} />
            <ClosePeriodForm id={id} status={period.status} />
          </>
        }
      />

      <SummaryCards
        totalHours={summary.total_hours}
        totalGrossPay={summary.total_gross_pay}
        totalMealDeduction={summary.total_meal_deduction}
        totalNetPay={summary.total_pay}
        employees={summary.rows.length}
        alcoholPoints={summary.total_alcohol_points}
      />

      <Calendar
        dates={allDates}
        approved={approvedDates}
        drafts={draftDates}
        sheets={sheets}
      />

      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="eyebrow-green">Per-employee summary</h2>
          <span className="text-xs text-[color:var(--muted)]">
            approved sheets only
          </span>
        </div>
        {summary.rows.length === 0 ? (
          <p className="surface border-dashed p-8 text-center text-sm text-[color:var(--muted)]">
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
  totalGrossPay,
  totalMealDeduction,
  totalNetPay,
  employees,
  alcoholPoints,
}: {
  totalHours: number
  totalGrossPay: number
  totalMealDeduction: number
  totalNetPay: number
  employees: number
  alcoholPoints: number
}) {
  const subtitle =
    totalMealDeduction > 0
      ? `gross $${totalGrossPay.toFixed(2)} − meals $${totalMealDeduction.toFixed(2)}`
      : `${employees} employee${employees === 1 ? '' : 's'}`
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card label="Total hours" value={totalHours.toFixed(2)} accent="pink" />
      <Card
        label="Net pay (paid out)"
        value={`$${totalNetPay.toFixed(2)}`}
        subtitle={subtitle}
        accent="green"
        emphasis
      />
      <Card label="Employees on payroll" value={employees.toString()} />
      <Card
        label="Alcohol points"
        value={alcoholPoints.toString()}
        accent="pink"
      />
    </div>
  )
}

function Card({
  label,
  value,
  subtitle,
  accent,
  emphasis,
}: {
  label: string
  value: string
  subtitle?: string
  accent?: 'pink' | 'green'
  emphasis?: boolean
}) {
  const railColor =
    accent === 'green'
      ? 'bg-[color:var(--tertiary)]'
      : accent === 'pink'
      ? 'bg-[color:var(--primary)]'
      : 'bg-transparent'
  return (
    <div
      className={
        'surface relative overflow-hidden p-4 ' +
        (emphasis
          ? 'shadow-[0_8px_24px_-12px_rgba(56,128,61,0.18)]'
          : '')
      }
    >
      {accent && (
        <span
          aria-hidden="true"
          className={`absolute left-0 top-3 h-6 w-0.5 rounded-full ${railColor}`}
        />
      )}
      <p className="text-xs text-[color:var(--muted)]">{label}</p>
      <p
        className={
          'mt-1 tabular-nums ' +
          (emphasis
            ? 'text-3xl font-semibold text-[color:var(--tertiary)]'
            : 'text-2xl font-semibold')
        }
      >
        {value}
      </p>
      {subtitle && (
        <p className="mt-1 text-[11px] text-[color:var(--muted)]">{subtitle}</p>
      )}
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
    <section className="mt-10">
      <h2 className="eyebrow mb-3">Days in this period</h2>
      <div className="flex flex-wrap gap-1.5">
        {dates.map((d) => {
          const sheet = sheetByDate.get(d)
          const isApproved = approved.has(d)
          const isDraft = drafts.has(d)
          const dot = isApproved
            ? 'bg-[color:var(--success)]'
            : isDraft
            ? 'bg-[color:var(--accent)]'
            : 'bg-transparent border border-[color:var(--border-strong)]'
          const cls = sheet
            ? 'surface hover:border-[color:var(--border-strong)]'
            : 'surface border-dashed text-[color:var(--muted)]'
          const inner = (
            <span className="block text-center">
              <span className="block text-[10px] uppercase tracking-wide text-[color:var(--muted)]">
                {fmtWeekday(d)}
              </span>
              <span className="mt-0.5 block text-sm font-medium tabular-nums">{fmtDayMonth(d)}</span>
              <span className={`mt-1.5 inline-block h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
            </span>
          )
          return sheet ? (
            <Link
              key={d}
              href={`/shifts/${sheet.id}`}
              className={`min-w-16 px-3 py-2 transition ${cls}`}
            >
              {inner}
            </Link>
          ) : (
            <span key={d} className={`min-w-16 px-3 py-2 ${cls}`} title="No sheet for this day">
              {inner}
            </span>
          )
        })}
      </div>
      <p className="mt-3 inline-flex items-center gap-3 text-xs text-[color:var(--muted)]">
        <span className="inline-flex items-center gap-1.5"><span className="dot bg-[color:var(--success)]" /> approved</span>
        <span className="inline-flex items-center gap-1.5"><span className="dot bg-[color:var(--accent)]" /> draft</span>
        <span className="inline-flex items-center gap-1.5"><span className="dot border border-[color:var(--border-strong)]" /> no sheet</span>
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
    <div className="surface overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="border-b border-[color:var(--border)] text-left text-xs font-normal text-[color:var(--muted)]">
          <tr>
            <th className="px-3 py-2.5 font-normal">Employee</th>
            <th className="px-3 py-2.5 font-normal text-right">Rate</th>
            <th className="px-3 py-2.5 font-normal text-right">Shifts</th>
            <th className="px-3 py-2.5 font-normal text-right">Hours</th>
            <th className="px-3 py-2.5 font-normal text-right">Gross pay</th>
            <th className="px-3 py-2.5 font-normal text-right">Meal $</th>
            <th className="px-3 py-2.5 font-normal text-right">Net pay</th>
            <th className="px-3 py-2.5 font-normal text-right">Alcohol pts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--border)]">
          {summary.rows.map((r) => (
            <tr key={r.employee_id ?? `__${r.employee_name}`}>
              <td className="px-3 py-2.5 font-medium">{r.employee_name}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">${r.hourly_rate.toFixed(2)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{r.shift_count}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{r.total_hours.toFixed(2)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-[color:var(--muted)]">
                ${r.gross_pay.toFixed(2)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-[color:var(--muted)]">
                {r.meal_count > 0 ? (
                  <span title={`${r.meal_count} meal${r.meal_count === 1 ? '' : 's'} × $${(2).toFixed(2)}`}>
                    −${r.meal_deduction.toFixed(2)}
                  </span>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                ${r.net_pay.toFixed(2)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums">{r.alcohol_points}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-[color:var(--border)]">
          <tr>
            <td className="px-3 py-2.5 text-xs text-[color:var(--muted)]">Total</td>
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5" />
            <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
              {summary.total_hours.toFixed(2)}
            </td>
            <td className="px-3 py-2.5 text-right tabular-nums text-[color:var(--muted)]">
              ${summary.total_gross_pay.toFixed(2)}
            </td>
            <td className="px-3 py-2.5 text-right tabular-nums text-[color:var(--muted)]">
              −${summary.total_meal_deduction.toFixed(2)}
            </td>
            <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
              ${summary.total_pay.toFixed(2)}
            </td>
            <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
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
