'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getSupabaseAdmin } from '@/lib/supabase/server'

const PayPeriodInput = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required'),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required'),
})

export async function createPayPeriod(formData: FormData) {
  const data = PayPeriodInput.parse(Object.fromEntries(formData))
  if (data.end_date < data.start_date) {
    throw new Error('End date must be on or after start date.')
  }
  const days = (new Date(data.end_date + 'T00:00:00').getTime() - new Date(data.start_date + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24)
  if (days > 31) {
    throw new Error('Pay period cannot exceed 31 days.')
  }
  const supabase = getSupabaseAdmin()
  // A period [s1, e1] overlaps [s2, e2] when s1 <= e2 AND e1 >= s2
  const { data: overlapping } = await supabase
    .from('pay_periods')
    .select('id, start_date, end_date')
    .lte('start_date', data.end_date)
    .gte('end_date', data.start_date)
    .limit(1)
  if (overlapping && overlapping.length > 0) {
    const o = overlapping[0]
    throw new Error(`Date range overlaps with existing period ${o.start_date} → ${o.end_date}. Adjust the dates.`)
  }
  const { data: row, error } = await supabase
    .from('pay_periods')
    .insert({ start_date: data.start_date, end_date: data.end_date, status: 'open' })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  // Back-fill any daily sheets that already exist inside this date range
  // but weren't linked to a period yet.
  await supabase
    .from('daily_sheets')
    .update({ pay_period_id: row.id })
    .gte('sheet_date', data.start_date)
    .lte('sheet_date', data.end_date)
    .is('pay_period_id', null)

  revalidatePath('/payroll')
  redirect(`/payroll/${row.id}`)
}

export async function setPayPeriodStatus(id: string, status: 'open' | 'closed' | 'exported') {
  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('pay_periods').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/payroll')
  revalidatePath(`/payroll/${id}`)
}

export async function deletePayPeriod(id: string) {
  const supabase = getSupabaseAdmin()
  // Unlink daily sheets so they're not cascade-deleted with the period.
  const { error: unlinkErr } = await supabase
    .from('daily_sheets')
    .update({ pay_period_id: null })
    .eq('pay_period_id', id)
  if (unlinkErr) throw new Error(unlinkErr.message)
  const { error } = await supabase.from('pay_periods').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/payroll')
  redirect('/payroll')
}
