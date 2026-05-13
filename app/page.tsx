import Link from 'next/link'
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase/server'
import { summarizePayPeriod, daysInRange, isoDate } from '@/lib/payroll'
import { GettingStarted } from './_onboarding/GettingStarted'
import { ShowWalkthroughButton } from './_onboarding/ShowWalkthroughButton'
import { getOnboardingStatus } from './_onboarding/getOnboardingStatus'
import type { PayPeriod, DailySheet, Shift, AlcoholSale } from '@/lib/types/db'

export const dynamic = 'force-dynamic'

type SheetWithChildren = DailySheet & { shifts: Shift[]; alcohol_sales: AlcoholSale[] }

async function getDashboardData() {
  if (!isSupabaseConfigured()) return null

  const supabase = getSupabaseAdmin()

  const { data: periodsData } = await supabase
    .from('pay_periods')
    .select('*')
    .eq('status', 'open')
    .order('start_date', { ascending: false })
    .limit(1)

  const period = (periodsData?.[0] ?? null) as PayPeriod | null

  if (!period) {
    return {
      period: null as PayPeriod | null,
      totalHours: 0,
      netPay: 0,
      daysNotFilled: 0,
      daysUntilPayroll: 0,
      allDates: [] as string[],
      approvedDates: new Set<string>(),
      draftDates: new Set<string>(),
      sheets: [] as SheetWithChildren[],
    }
  }

  const { data: sheetsData } = await supabase
    .from('daily_sheets')
    .select('*, shifts (*), alcohol_sales (*)')
    .eq('pay_period_id', period.id)

  const sheets = (sheetsData ?? []) as SheetWithChildren[]
  const approved = sheets.filter((s) => s.status === 'approved')
  const drafts = sheets.filter((s) => s.status !== 'approved')

  const summary = summarizePayPeriod(
    approved.map((s) => ({
      sheet_date: s.sheet_date,
      shifts: s.shifts,
      alcohol_sales: s.alcohol_sales,
    }))
  )

  const today = isoDate(new Date())
  const allDates = daysInRange(period.start_date, period.end_date)
  const approvedDates = new Set(approved.map((s) => s.sheet_date))
  const draftDates = new Set(drafts.map((s) => s.sheet_date))
  const pastDays = allDates.filter((d) => d <= today)
  const daysNotFilled = pastDays.filter((d) => !approvedDates.has(d) && !draftDates.has(d)).length

  const endDate = new Date(period.end_date + 'T00:00:00')
  const todayDate = new Date(today + 'T00:00:00')
  const daysUntilPayroll = Math.max(
    0,
    Math.round((endDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24))
  )

  return {
    period,
    totalHours: summary.total_hours,
    netPay: summary.total_pay,
    daysNotFilled,
    daysUntilPayroll,
    allDates,
    approvedDates,
    draftDates,
    sheets,
  }
}

export default async function Home() {
  const [data, onboarding] = await Promise.all([
    getDashboardData(),
    getOnboardingStatus(),
  ])
  const today = isoDate(new Date())

  const hasPeriod = !!data?.period
  const totalHours = data?.totalHours ?? 0
  const netPay = data?.netPay ?? 0
  const daysNotFilled = data?.daysNotFilled ?? 0
  const daysUntilPayroll = data?.daysUntilPayroll ?? 0

  return (
    <div className="mx-auto max-w-4xl">

      {/* Period heading */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          {hasPeriod ? (
            <>
              <p className="eyebrow-green mb-1.5">Current period</p>
              <h1 className="text-3xl font-bold tracking-tight">
                {fmtRange(data!.period!.start_date, data!.period!.end_date)}
              </h1>
            </>
          ) : (
            <>
              <p className="eyebrow mb-1.5">No active period</p>
              <h1 className="text-3xl font-bold tracking-tight text-[color:var(--muted)]">
                No pay period open
              </h1>
            </>
          )}
        </div>
        {hasPeriod ? (
          <Link href={`/payroll/${data!.period!.id}`} className="btn-tertiary shrink-0">
            Show Current Period →
          </Link>
        ) : (
          <Link href="/payroll" className="btn-tertiary shrink-0">
            Create Period →
          </Link>
        )}
      </div>

      {/* Metric cards — always rendered, dashes when no period */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Total hours"
          value={hasPeriod ? totalHours.toFixed(1) : '—'}
          accent="pink"
        />
        <MetricCard
          label="Net pay"
          value={hasPeriod ? `$${netPay.toFixed(2)}` : '—'}
          accent="green"
          emphasis={hasPeriod}
        />
        <MetricCard
          label="Days not filled"
          value={hasPeriod ? daysNotFilled.toString() : '—'}
          accent={daysNotFilled > 0 ? 'pink' : undefined}
        />
        <MetricCard
          label="Days until payroll"
          value={hasPeriod ? daysUntilPayroll.toString() : '—'}
          accent="green"
        />
      </div>

      {/* Calendar */}
      <section className="mb-8">
        <h2 className="eyebrow mb-3">Days in this period</h2>
        {hasPeriod && data!.allDates.length > 0 ? (
          <PeriodCalendar
            dates={data!.allDates}
            approved={data!.approvedDates}
            drafts={data!.draftDates}
            sheets={data!.sheets}
            today={today}
          />
        ) : (
          <div className="surface border-dashed p-8 text-center">
            <p className="text-sm text-[color:var(--muted)]">
              No active pay period. Create one to see the shift calendar here.
            </p>
          </div>
        )}
      </section>

      {/* Primary CTA */}
      <div className="mb-10">
        <Link href="/scan" className="btn-primary block w-full py-3 text-center text-base">
          Quick Add Sheet →
        </Link>
      </div>

      {/* Onboarding walkthrough */}
      {onboarding && <GettingStarted status={onboarding} />}
      <div className="mt-4 flex justify-end">
        <ShowWalkthroughButton />
      </div>

    </div>
  )
}

function PeriodCalendar({
  dates,
  approved,
  drafts,
  sheets,
  today,
}: {
  dates: string[]
  approved: Set<string>
  drafts: Set<string>
  sheets: SheetWithChildren[]
  today: string
}) {
  const sheetByDate = new Map(sheets.map((s) => [s.sheet_date, s]))
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {dates.map((d) => {
          const sheet = sheetByDate.get(d)
          const isApproved = approved.has(d)
          const isDraft = drafts.has(d)
          const isToday = d === today
          const dot = isApproved
            ? 'bg-[color:var(--success)]'
            : isDraft
            ? 'bg-[color:var(--accent)]'
            : 'bg-transparent border border-[color:var(--border-strong)]'
          const cls =
            'surface min-w-16 px-3 py-2 ' +
            (isToday ? 'border-[color:var(--primary)] ' : '') +
            (sheet
              ? 'hover:border-[color:var(--border-strong)] transition'
              : 'border-dashed text-[color:var(--muted)]')
          const inner = (
            <span className="block text-center">
              <span className="block text-[10px] uppercase tracking-wide text-[color:var(--muted)]">
                {fmtWeekday(d)}
              </span>
              <span
                className={
                  'mt-0.5 block text-sm font-medium tabular-nums ' +
                  (isToday ? 'text-[color:var(--primary)]' : '')
                }
              >
                {fmtDayMonth(d)}
              </span>
              <span
                className={`mt-1.5 inline-block h-1.5 w-1.5 rounded-full ${dot}`}
                aria-hidden
              />
            </span>
          )
          return sheet ? (
            <Link key={d} href={`/shifts/${sheet.id}`} className={cls}>
              {inner}
            </Link>
          ) : (
            <span key={d} className={cls} title="No sheet for this day">
              {inner}
            </span>
          )
        })}
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[color:var(--muted)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="dot bg-[color:var(--success)]" /> approved
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="dot bg-[color:var(--accent)]" /> draft
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="dot border border-[color:var(--border-strong)]" /> no sheet
        </span>
      </p>
    </div>
  )
}

function MetricCard({
  label,
  value,
  accent,
  emphasis,
}: {
  label: string
  value: string
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
        (emphasis ? 'shadow-[0_8px_24px_-12px_rgba(56,128,61,0.18)]' : '')
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
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}
