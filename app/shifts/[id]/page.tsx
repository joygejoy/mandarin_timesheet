import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { summarizeDay } from '@/lib/payroll'
import { addShift, setDailySheetStatus } from '../actions'
import { ShiftRows } from './ShiftRows'
import { AddShiftForm } from './AddShiftForm'
import { AlcoholSection } from './AlcoholSection'
import { ScanPhotoPanel } from './ScanPhotoPanel'
import { DeleteSheetButton } from './DeleteSheetButton'
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
    // Fetch unordered. We sort below in JS using display_order (when present)
    // → start_time → created_at, which keeps the query working whether or not
    // migration 0002_shift_display_order.sql has been applied.
    supabase
      .from('shifts')
      .select('*')
      .eq('daily_sheet_id', id),
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
  const employees = (employeesRow ?? []) as Employee[]
  const alcoholSales = (alcoholRow ?? []) as AlcoholSale[]
  // Sort shifts client-side: display_order if present (post-migration),
  // otherwise start_time, otherwise created_at. Stable across both states.
  const shifts = ((shiftsRow ?? []) as Shift[])
    .slice()
    .sort((a, b) => {
      const aOrd = a.display_order ?? Number.POSITIVE_INFINITY
      const bOrd = b.display_order ?? Number.POSITIVE_INFINITY
      if (aOrd !== bOrd) return aOrd - bOrd
      const at = a.start_time ?? '99:99'
      const bt = b.start_time ?? '99:99'
      if (at !== bt) return at.localeCompare(bt)
      return (a.created_at ?? '').localeCompare(b.created_at ?? '')
    })

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
        <Link href="/shifts" className="text-sm text-[color:var(--muted)] hover:text-[color:var(--foreground)]">
          ← Daily shifts
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{fmtDateLong(sheet.sheet_date)}</h1>
            <p className="mt-1 text-sm text-[color:var(--muted)]">
              <span className="font-medium text-[color:var(--foreground)]">{sheet.status}</span>
              {period ? (
                <>
                  {' · '}
                  <Link href={`/payroll/${period.id}`} className="link-soft">
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

      {sheet.scan_image_path && (
        <section className="mt-6">
          <ScanPhotoPanel sheetId={sheet.id} />
        </section>
      )}

      {sheet.status !== 'approved' && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm text-[color:var(--muted)]">Add a shift</h2>
          <AddShiftForm dailySheetId={sheet.id} employees={employees} addShift={addShift} />
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm text-[color:var(--muted)]">
          Shifts ({shifts.length})
        </h2>
        {shifts.length === 0 ? (
          <p className="surface border-dashed p-6 text-center text-sm text-[color:var(--muted)]">
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
            <button className="btn-tertiary" type="submit">
              Approve day
            </button>
          </form>
        )
      )}
      <DeleteSheetButton sheetId={sheet.id} />
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
      <Card
        label="Net pay"
        value={`$${summary.total_pay.toFixed(2)}`}
        subtitle={
          summary.total_meal_deduction > 0
            ? `gross $${summary.total_gross_pay.toFixed(2)} − meals $${summary.total_meal_deduction.toFixed(2)}`
            : undefined
        }
      />
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
  subtitle,
}: {
  label: string
  value: string
  tone?: 'default' | 'warn'
  subtitle?: string
}) {
  const accent = tone === 'warn' ? 'text-amber-700 dark:text-amber-300' : ''
  return (
    <div className="surface p-4">
      <p className="text-xs text-[color:var(--muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${accent}`}>{value}</p>
      {subtitle && (
        <p className="mt-1 text-[11px] text-[color:var(--muted)]">{subtitle}</p>
      )}
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
