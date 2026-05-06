import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { summarizePayPeriod } from '@/lib/payroll'
import {
  GoogleSheetsNotConfiguredError,
  isGoogleSheetsConfigured,
  pushBiweeklySummary,
} from '@/lib/google-sheets'
import type { PayPeriod, DailySheet, Shift, AlcoholSale } from '@/lib/types/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SheetWithChildren = DailySheet & { shifts: Shift[]; alcohol_sales: AlcoholSale[] }

export async function POST(
  _req: NextRequest,
  ctx: RouteContext<'/api/payroll/[id]/sheets'>
) {
  const { id } = await ctx.params

  // Fail fast with a Sheets-specific message if the integration env vars
  // aren't set — that's the most useful error for someone hitting this
  // endpoint, even before we touch the database.
  if (!isGoogleSheetsConfigured()) {
    return Response.json(
      { error: new GoogleSheetsNotConfiguredError().message },
      { status: 503 }
    )
  }

  let supabase
  try {
    supabase = getSupabaseAdmin()
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Supabase not configured' },
      { status: 503 }
    )
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
  if (periodErr) return Response.json({ error: periodErr.message }, { status: 500 })
  if (!periodRow) return Response.json({ error: 'Pay period not found' }, { status: 404 })
  if (sheetsErr) return Response.json({ error: sheetsErr.message }, { status: 500 })

  const period = periodRow as PayPeriod
  const sheets = (sheetsRow ?? []) as SheetWithChildren[]

  const summary = summarizePayPeriod(
    sheets.map((s) => ({
      sheet_date: s.sheet_date,
      shifts: s.shifts,
      alcohol_sales: s.alcohol_sales,
    }))
  )

  try {
    const result = await pushBiweeklySummary({
      startDate: period.start_date,
      endDate: period.end_date,
      summary,
    })
    return Response.json({
      ok: true,
      tabName: result.tabName,
      url: result.url,
    })
  } catch (err) {
    if (err instanceof GoogleSheetsNotConfiguredError) {
      return Response.json({ error: err.message }, { status: 503 })
    }
    const message = err instanceof Error ? err.message : 'Unknown Google Sheets error'
    // Surface common Google API errors with a friendlier hint.
    const hinted =
      /permission|forbidden|access/i.test(message) && !/credentials/i.test(message)
        ? `${message}. Make sure you shared the spreadsheet with the service account email (client_email in the JSON).`
        : message
    return Response.json({ error: hinted }, { status: 500 })
  }
}
