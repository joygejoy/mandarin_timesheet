import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { summarizePayPeriod } from '@/lib/payroll'
import type { PayPeriod, DailySheet, Shift, AlcoholSale } from '@/lib/types/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SheetWithChildren = DailySheet & { shifts: Shift[]; alcohol_sales: AlcoholSale[] }

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/payroll/[id]/csv'>) {
  const { id } = await ctx.params
  const supabase = getSupabaseAdmin()

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

  const lines: string[] = []
  lines.push(
    [
      `# Mandarin Timesheet — ${period.start_date} to ${period.end_date}`,
    ].join(',')
  )
  lines.push(
    [
      'Employee',
      'Rate',
      'Shifts',
      'Hours',
      'Gross pay',
      'Meals',
      'Meal deduction',
      'Net pay',
      'Alcohol points',
    ].join(',')
  )
  for (const r of summary.rows) {
    lines.push(
      [
        csvField(r.employee_name),
        r.hourly_rate.toFixed(2),
        r.shift_count.toString(),
        r.total_hours.toFixed(2),
        r.gross_pay.toFixed(2),
        r.meal_count.toString(),
        r.meal_deduction.toFixed(2),
        r.net_pay.toFixed(2),
        r.alcohol_points.toString(),
      ].join(',')
    )
  }
  lines.push(
    [
      'TOTAL',
      '',
      '',
      summary.total_hours.toFixed(2),
      summary.total_gross_pay.toFixed(2),
      '',
      summary.total_meal_deduction.toFixed(2),
      summary.total_pay.toFixed(2),
      summary.total_alcohol_points.toString(),
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
