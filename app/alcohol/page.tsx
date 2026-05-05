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
      <header className="pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Alcohol sales</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Drink-point leaderboard for a pay period. Enter daily totals on each day’s sheet at{' '}
          <Link href="/shifts" className="underline">
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
            <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
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
    <form className="mb-6 flex items-center gap-3" action="/alcohol">
      <label className="text-sm text-zinc-500">Pay period</label>
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
    { rank: 2, row: ranked[1], medal: '🥈', height: 'h-28', emphasis: 'border-zinc-300' },
    { rank: 1, row: ranked[0], medal: '🥇', height: 'h-36', emphasis: 'border-amber-400 bg-amber-50 dark:bg-amber-950/30' },
    { rank: 3, row: ranked[2], medal: '🥉', height: 'h-24', emphasis: 'border-orange-300' },
  ]
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">Top sellers</h2>
      <div className="grid grid-cols-3 items-end gap-3">
        {slots.map(({ rank, row, medal, height, emphasis }) => (
          <div
            key={rank}
            className={`flex ${height} flex-col items-center justify-end rounded-lg border-2 p-3 text-center ${emphasis} bg-white dark:bg-zinc-900`}
          >
            {row ? (
              <>
                <span className="text-2xl">{medal}</span>
                <p className="mt-2 text-sm font-medium">{row.employee_name}</p>
                <p className="text-lg font-semibold tabular-nums">{row.alcohol_points} pts</p>
              </>
            ) : (
              <span className="text-xs text-zinc-400">—</span>
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
      <h2 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">Full ranking</h2>
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/50">
            <tr>
              <th className="w-10 px-3 py-3 font-medium">#</th>
              <th className="px-3 py-3 font-medium">Server</th>
              <th className="px-3 py-3 font-medium text-right">Total points</th>
              <th className="px-3 py-3 font-medium text-right">% of period</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {ranked.map((r, i) => {
              const pct = totalPoints > 0 ? (r.alcohol_points / totalPoints) * 100 : 0
              return (
                <tr key={r.employee_name + i}>
                  <td className="px-3 py-2 text-zinc-500 tabular-nums">{i + 1}</td>
                  <td className="px-3 py-2 font-medium">{r.employee_name}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{r.alcohol_points}</td>
                  <td className="px-3 py-2 text-right text-zinc-500 tabular-nums">{pct.toFixed(1)}%</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-zinc-50 dark:bg-zinc-800/50">
            <tr>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-xs uppercase tracking-wide text-zinc-500">Period total</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">{totalPoints}</td>
              <td className="px-3 py-2" />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

function NoPeriods() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
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
