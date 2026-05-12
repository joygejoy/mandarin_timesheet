import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase/server'
import { SetupRequired } from '@/app/_components/SetupRequired'
import { PageHero } from '@/app/_components/PageHero'
import { isoDate, summarizeDay } from '@/lib/payroll'
import { createDailySheet } from './actions'
import { SheetsClient, type SheetRow } from './SheetsClient'
import type { DailySheet, Shift } from '@/lib/types/db'

export const dynamic = 'force-dynamic'

type SheetWithShifts = DailySheet & { shifts: Shift[] }

export default async function ShiftsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="mx-auto max-w-4xl">
        <PageHero eyebrow="Daily · Shifts" title="Daily shifts" />
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
  const todaySheetId = sheets.find((s) => s.sheet_date === today)?.id ?? null

  // Pre-summarize on the server so the client component doesn't need the full shift rows.
  const rows: SheetRow[] = sheets.map((s) => {
    const sum = summarizeDay(s.shifts)
    return {
      id: s.id,
      sheet_date: s.sheet_date,
      status: s.status,
      pay_period_id: s.pay_period_id,
      scan_image_path: s.scan_image_path,
      shift_count: sum.shift_count,
      total_hours: sum.total_hours,
      total_pay: sum.total_pay,
    }
  })

  return (
    <div className="mx-auto max-w-4xl">
      <PageHero
        eyebrow="Daily · Shifts"
        title="Daily shifts"
        subtitle="One sheet per calendar day. Open today below, or jump to any past date — sheets are created on first open."
      />

      <OpenDayPanel today={today} todaySheetId={todaySheetId} />

      <section className="mt-10">
        <h2 className="eyebrow mb-3">All daily sheets</h2>
        <SheetsClient sheets={rows} />
      </section>
    </div>
  )
}

function OpenDayPanel({
  today,
  todaySheetId,
}: {
  today: string
  todaySheetId: string | null
}) {
  return (
    <section className="surface p-5">
      <p className="eyebrow mb-1.5">Today</p>
      <h2 className="text-lg font-semibold leading-tight">Open a day</h2>
      <p className="mt-1.5 text-xs text-[color:var(--muted)]">
        Click <strong>Open today</strong> for {fmtDateLong(today)}, or pick any other date and click{' '}
        <strong>Open</strong>. If a sheet already exists for that date you&rsquo;ll jump to it; otherwise a new draft is created.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        {/* Primary action: today, single-click */}
        <form action={createDailySheet}>
          <input type="hidden" name="sheet_date" value={today} />
          <button className="btn-primary" type="submit">
            {todaySheetId ? 'Open today →' : '+ Open today'}
          </button>
        </form>

        <span className="hidden text-xs text-[color:var(--muted)] sm:inline">or pick a date:</span>

        <form action={createDailySheet} className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-[color:var(--muted)]">Date</span>
            <input
              type="date"
              name="sheet_date"
              required
              defaultValue={today}
              className="input"
            />
          </label>
          <button className="btn-secondary" type="submit">
            Open
          </button>
        </form>
      </div>
    </section>
  )
}

function fmtDateLong(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}
