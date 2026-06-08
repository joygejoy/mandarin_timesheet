import { NextRequest } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { summarizePayPeriod } from '@/lib/payroll'
import { renderPayrollPdf } from '@/lib/pdf-render'
import { buildEnrichedRows } from '@/lib/payroll-export'
import type { PayPeriod, DailySheet, Shift, AlcoholSale } from '@/lib/types/db'

// pdfkit needs Node APIs (Buffer, streams) — opt out of the Edge runtime.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type SheetWithChildren = DailySheet & { shifts: Shift[]; alcohol_sales: AlcoholSale[] }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/payroll/[id]/pdf'>) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return new Response('Invalid id', { status: 400 })
  let supabase: ReturnType<typeof getSupabaseAdmin>
  try {
    supabase = getSupabaseAdmin()
  } catch (err) {
    return new Response(err instanceof Error ? err.message : 'Supabase not configured', { status: 503 })
  }

  // Mirror the CSV route exactly: only approved sheets, ordered by date.
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

  let pdf: Buffer
  try {
    pdf = await renderPayrollPdf(period, summary, rows)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to render PDF'
    return new Response(message, { status: 500 })
  }

  const filename = `payroll_${period.start_date}_${period.end_date}.pdf`
  // Wrap pdfkit's Buffer in a Blob so the body is a standard BodyInit.
  const blob = new Blob([new Uint8Array(pdf)], { type: 'application/pdf' })
  return new Response(blob, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdf.byteLength.toString(),
      'Cache-Control': 'no-store',
    },
  })
}
