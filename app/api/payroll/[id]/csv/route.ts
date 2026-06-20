import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { summarizePayPeriod } from '@/lib/payroll'
import type { PayPeriod, DailySheet, Shift, AlcoholSale } from '@/lib/types/db'
import { buildEnrichedRows } from '@/lib/payroll-export'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SheetWithChildren = DailySheet & { shifts: Shift[]; alcohol_sales: AlcoholSale[] }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/payroll/[id]/csv'>) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return new Response('Invalid id', { status: 400 })
  let supabase: ReturnType<typeof getSupabaseAdmin>
  try {
    supabase = getSupabaseAdmin()
  } catch (err) {
    return new Response(err instanceof Error ? err.message : 'Supabase not configured', { status: 503 })
  }

  const [{ data: periodRow, error: periodErr }, { data: sheetsRow, error: sheetsErr }] =
    await Promise.all([
      supabase.from('pay_periods').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('daily_sheets')
        .select('*, shifts (*), alcohol_sales (*)')
        .eq('pay_period_id', id)
        .eq('status', 'approved')
        .order('sheet_date', { ascending: true }),
    ])
  if (periodErr) return new Response(periodErr.message, { status: 500 })
  if (!periodRow) return new Response('Pay period not found', { status: 404 })
  if (sheetsErr) return new Response(sheetsErr.message, { status: 500 })

  const period = periodRow as PayPeriod
  const sheets = (sheetsRow ?? []) as SheetWithChildren[]

  const summary = summarizePayPeriod(
    sheets.map((s) => ({
      sheet_date: s.sheet_date,
      shifts: s.shifts,
      alcohol_sales: s.alcohol_sales,
    }))
  )

  const rows = await buildEnrichedRows(summary, supabase)

  // Day-of-week order: Mon(1)→Tue(2)→Wed(3)→Thu(4)→Fri(5)→Sat(6)→Sun(0)
  const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]
  const DOW_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  function hoursByDow(byDate: Record<string, { minutes: number }>): number[] {
    const totals = [0, 0, 0, 0, 0, 0, 0] // index = DOW_ORDER position
    for (const [dateStr, cell] of Object.entries(byDate)) {
      const jsDay = new Date(dateStr + 'T12:00:00').getDay() // 0=Sun…6=Sat
      const idx = DOW_ORDER.indexOf(jsDay)
      if (idx !== -1) totals[idx] += cell.minutes
    }
    // Round each day's total down to 15-min interval, then convert to hours
    return totals.map((m) => Math.floor(m / 15) * 15 / 60)
  }

  const lines: string[] = []
  lines.push(`# Mandarin Timesheet — ${period.start_date} to ${period.end_date}`)
  lines.push(
    [
      'Emp #',
      'Department',
      'Name',
      'Total Hours',
      'Meal',
      'Alcohol Count',
      ...DOW_LABELS,
      'Total Hours',
    ].join(',')
  )
  for (const r of rows) {
    const dow = hoursByDow(r.by_date)
    lines.push(
      [
        r.employee_number != null ? r.employee_number.toString() : '',
        csvField(r.department ?? ''),
        csvField(r.employee_name),
        r.total_hours.toFixed(2),
        r.meal_count > 0 ? 'Yes' : 'No',
        r.alcohol_points.toString(),
        ...dow.map((h) => h > 0 ? h.toFixed(2) : ''),
        r.total_hours.toFixed(2),
      ].join(',')
    )
  }
  lines.push(
    [
      '',
      '',
      'TOTAL',
      summary.total_hours.toFixed(2),
      '',
      summary.total_alcohol_points.toString(),
      ...DOW_LABELS.map(() => ''),
      summary.total_hours.toFixed(2),
    ].join(',')
  )

  const filename = `payroll_${period.start_date}_${period.end_date}.csv`
  return new Response('﻿' + lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

/** Quote a CSV field if it contains a comma, quote, or newline. */
function csvField(s: string): string {
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}
