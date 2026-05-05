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
  const supabase = getSupabaseAdmin()
  const { data: row, error } = await supabase
    .from('pay_periods')
    .insert({ start_date: data.start_date, end_date: data.end_date, status: 'open' })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
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
