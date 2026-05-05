import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { summarizeDay } from '@/lib/payroll'
import { addShift, setDailySheetStatus, deleteDailySheet } from '../actions'
import { ShiftRows } from './ShiftRows'
import { AddShiftForm } from './AddShiftForm'
import { AlcoholSection } from './AlcoholSection'
import type { DailySheet, Shift, Employee, PayPeriod, AlcoholSale } from '@/lib/types/db'

export const dynamic = 'force-dynamic'

export default async function DailySheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = getSupabaseAdmin()

  const [
    { data: sheetRow, error: sheetErr },
    { data: shiftsRow },
    { data: employeesRow },
    { data: alcoholRow },
  ] = await Promise.all([
    supabase.from('daily_sheets').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('shifts')
      .select('*')
      .eq('daily_sheet_id', id)
      .order('start_time', { ascending: true, nullsFirst: false }),
    supabase
      .from('employees')
      .select('*')
      .eq('active', true)
      .order('full_name', { ascending: true }),
    supabase
      .from('alcohol_sales')
      .select('*')
      .eq('daily_sheet_id', id),
  ])

  if (sheetErr) throw new Error(sheetErr.message)
  if (!sheetRow) notFound()

  const sheet = sheetRow as DailySheet
  const shifts = (shiftsRow ?? []) as Shift[]
  const employees = (employeesRow ?? []) as Employee[]
  const alcoholSales = (alcoholRow ?? []) as AlcoholSale[]

  // Resolve enclosing pay period if any (for the header link).
  let period: PayPeriod | null = null
  if (sheet.pay_period_id) {
    const { data } = await supabase
      .from('pay_periods')
      .select('*')
      .eq('id', sheet.pay_period_id)
      .maybeSingle()
    period = (data as PayPeriod | null) ?? null
  }

  const summary = summarizeDay(shifts)

  return (
    <div className="mx-auto max-w-6xl">
      <header className="pb-6">
        <Link href="/shifts" className="text-sm text-zinc-500 hover:underline">
          ← Daily shifts
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{fmtDateLong(sheet.sheet_date)}</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Status: <span className="font-medium">{sheet.status}</span>
              {period ? (
                <>
                  {' · '}
                  <Link href={`/payroll/${period.id}`} className="hover:underline">
                    Pay period {fmtShort(period.start_date)} → {fmtShort(period.end_date)}
                  </Link>
                </>
              ) : (
                <span className="ml-2 text-amber-700 dark:text-amber-400">
                  no pay period covers this date —{' '}
                  <Link href="/payroll" className="underline">
                    create one
                  </Link>
                </span>
              )}
            </p>
          </div>
          <SheetActions sheet={sheet} hasShifts={shifts.length > 0} />
        </div>
      </header>

      <SummaryCards summary={summary} />

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">Add a shift</h2>
        <AddShiftForm dailySheetId={sheet.id} employees={employees} addShift={addShift} />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Shifts ({shifts.length})
        </h2>
        {shifts.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
            No shifts yet. Add one above.
          </p>
        ) : (
          <ShiftRows shifts={shifts} sheetId={sheet.id} employees={employees} readOnly={sheet.status === 'approved'} />
        )}
      </section>

      <AlcoholSection
        sheetId={sheet.id}
        shifts={shifts}
        alcoholSales={alcoholSales}
        employees={employees}
        readOnly={sheet.status === 'approved'}
      />
    </div>
  )
}

function SheetActions({ sheet, hasShifts }: { sheet: DailySheet; hasShifts: boolean }) {
  async function approve() {
    'use server'
    await setDailySheetStatus(sheet.id, 'approved')
  }
  async function unapprove() {
    'use server'
    await setDailySheetStatus(sheet.id, 'draft')
  }
  async function del() {
    'use server'
    await deleteDailySheet(sheet.id)
  }
  return (
    <div className="flex gap-2">
      {sheet.status === 'approved' ? (
        <form action={unapprove}>
          <button className="btn-secondary" type="submit">
            Unapprove
          </button>
        </form>
      ) : (
        hasShifts && (
          <form action={approve}>
            <button className="btn-primary" type="submit">
              Approve day
            </button>
          </form>
        )
      )}
      <form action={del}>
        <button
          className="text-xs text-rose-600 hover:underline"
          type="submit"
          // confirm via a tiny inline pattern; full client confirm modal would be overkill
          formNoValidate
        >
          Delete sheet
        </button>
      </form>
    </div>
  )
}

function SummaryCards({
  summary,
}: {
  summary: ReturnType<typeof summarizeDay>
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Card label="Total hours" value={summary.total_hours.toFixed(2)} />
      <Card label="Total pay" value={`$${summary.total_pay.toFixed(2)}`} />
      <Card label="Employees" value={summary.rows.length.toString()} />
      <Card
        label="Flagged for review"
        value={summary.exception_count.toString()}
        tone={summary.exception_count > 0 ? 'warn' : 'default'}
      />
    </div>
  )
}

function Card({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'warn'
}) {
  const accent = tone === 'warn' ? 'text-amber-700 dark:text-amber-300' : ''
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${accent}`}>{value}</p>
    </div>
  )
}

function fmtDateLong(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}
function fmtShort(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}
