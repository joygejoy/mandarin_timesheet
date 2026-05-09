import Link from 'next/link'
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase/server'
import { SetupRequired } from '@/app/_components/SetupRequired'
import { summarizePayPeriod } from '@/lib/payroll'
import type { PayPeriod, DailySheet, AlcoholSale } from '@/lib/types/db'

export const dynamic = 'force-dynamic'

type SheetWithAlcohol = DailySheet & { alcohol_sales: AlcoholSale[] }

export default async function AlcoholPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto max-w-4xl">
        <h1 className="pb-6 text-2xl font-semibold tracking-tight">Alcohol sales</h1>
        <SetupRequired />
      </div>
    )
  }

  const { period: periodParam } = await searchParams
  const supabase = getSupabaseAdmin()

  const { data: periods } = await supabase
    .from('pay_periods')
    .select('*')
    .order('start_date', { ascending: false })

  const periodList = (periods ?? []) as PayPeriod[]
  const activePeriod =
    periodList.find((p) => p.id === periodParam) ?? periodList[0] ?? null

  let summary: ReturnType<typeof summarizePayPeriod> | null = null
  if (activePeriod) {
    const { data: sheets } = await supabase
      .from('daily_sheets')
      .select('*, alcohol_sales (*)')
      .eq('pay_period_id', activePeriod.id)
      .order('sheet_date', { ascending: true })

    const arr = (sheets ?? []) as SheetWithAlcohol[]
    summary = summarizePayPeriod(
      arr.map((s) => ({
        sheet_date: s.sheet_date,
        shifts: [],
        alcohol_sales: s.alcohol_sales,
      }))
    )
  }

  const ranked = summary
    ? [...summary.rows]
        .filter((r) => r.alcohol_points > 0)
        .sort((a, b) => b.alcohol_points - a.alcohol_points)
    : []

  return (
    <div className="mx-auto max-w-5xl">
      <header className="pb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Alcohol sales</h1>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          Drink-point leaderboard for a pay period. Enter daily totals on each day's sheet at{' '}
          <Link href="/shifts" className="link-soft">
            Daily shifts
          </Link>
          .
        </p>
      </header>

      {periodList.length === 0 ? (
        <NoPeriods />
      ) : (
        <>
          <PeriodPicker periods={periodList} activeId={activePeriod?.id ?? null} />

          {!summary ? null : ranked.length === 0 ? (
            <p className="surface border-dashed p-8 text-center text-sm text-[color:var(--muted)]">
              No alcohol points logged in this period yet.
            </p>
          ) : (
            <>
              <Podium ranked={ranked.slice(0, 3)} />
              <Table ranked={ranked} dates={summary.dates} totalPoints={summary.total_alcohol_points} />
            </>
          )}
        </>
      )}
    </div>
  )
}

function PeriodPicker({
  periods,
  activeId,
}: {
  periods: PayPeriod[]
  activeId: string | null
}) {
  return (
    <form className="mb-8 flex items-center gap-3" action="/alcohol">
      <label className="text-sm text-[color:var(--muted)]">Pay period</label>
      <select name="period" defaultValue={activeId ?? undefined} className="input max-w-xs">
        {periods.map((p) => (
          <option key={p.id} value={p.id}>
            {fmtRange(p.start_date, p.end_date)}
            {p.status !== 'open' ? ` · ${p.status}` : ''}
          </option>
        ))}
      </select>
      <button className="btn-secondary" type="submit">
        Show
      </button>
    </form>
  )
}

function Podium({
  ranked,
}: {
  ranked: { employee_name: string; alcohol_points: number }[]
}) {
  // Order on screen left→right: 2nd, 1st, 3rd. (Classic podium).
  const slots: { rank: number; row?: (typeof ranked)[number]; medal: string; height: string; emphasis: string }[] = [
    { rank: 2, row: ranked[1], medal: '2nd', height: 'h-28', emphasis: '' },
    { rank: 1, row: ranked[0], medal: '1st', height: 'h-36', emphasis: 'ring-1 ring-amber-400/70' },
    { rank: 3, row: ranked[2], medal: '3rd', height: 'h-24', emphasis: '' },
  ]
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm text-[color:var(--muted)]">Top sellers</h2>
      <div className="grid grid-cols-3 items-end gap-3">
        {slots.map(({ rank, row, medal, height, emphasis }) => (
          <div
            key={rank}
            className={`surface flex ${height} flex-col items-center justify-end p-3 text-center ${emphasis}`}
          >
            {row ? (
              <>
                <span className="text-xs uppercase tracking-wide text-[color:var(--muted)]">{medal}</span>
                <p className="mt-2 text-sm font-medium">{row.employee_name}</p>
                <p className="text-lg font-semibold tabular-nums">{row.alcohol_points} pts</p>
              </>
            ) : (
              <span className="text-xs text-[color:var(--muted)]">—</span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function Table({
  ranked,
  totalPoints,
}: {
  ranked: { employee_name: string; alcohol_points: number; by_date: Record<string, { alcohol_points: number }> }[]
  dates: string[]
  totalPoints: number
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm text-[color:var(--muted)]">Full ranking</h2>
      <div className="surface overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="border-b border-[color:var(--border)] text-left text-xs font-normal text-[color:var(--muted)]">
            <tr>
              <th className="w-10 px-3 py-2.5 font-normal">#</th>
              <th className="px-3 py-2.5 font-normal">Server</th>
              <th className="px-3 py-2.5 font-normal text-right">Total points</th>
              <th className="px-3 py-2.5 font-normal text-right">% of period</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--border)]">
            {ranked.map((r, i) => {
              const pct = totalPoints > 0 ? (r.alcohol_points / totalPoints) * 100 : 0
              return (
                <tr key={r.employee_name + i}>
                  <td className="px-3 py-2.5 text-[color:var(--muted)] tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2.5 font-medium">{r.employee_name}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{r.alcohol_points}</td>
                  <td className="px-3 py-2.5 text-right text-[color:var(--muted)] tabular-nums">{pct.toFixed(1)}%</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t border-[color:var(--border)]">
            <tr>
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5 text-xs text-[color:var(--muted)]">Period total</td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{totalPoints}</td>
              <td className="px-3 py-2.5" />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

function NoPeriods() {
  return (
    <div className="surface border-dashed p-8 text-center text-sm text-[color:var(--muted)]">
      <p>No pay periods yet.</p>
      <Link href="/payroll" className="btn-primary mt-4 inline-flex">
        Create a pay period
      </Link>
    </div>
  )
}

function fmtRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  const fmt = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString(undefined, opts)
  return `${fmt(start)} → ${fmt(end)}`
}
