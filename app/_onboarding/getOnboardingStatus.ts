import 'server-only'
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase/server'

export type OnboardingStep = {
  id: 'roster' | 'scan' | 'confirm' | 'alcohol' | 'approve' | 'payroll'
  title: string
  href: string
  done: boolean
}

export type OnboardingStatus = {
  steps: OnboardingStep[]
  doneCount: number
  totalCount: number
}

const STEP_DEFS: Array<Pick<OnboardingStep, 'id' | 'title' | 'href'>> = [
  { id: 'roster', title: 'Add your roster', href: '/employees/import' },
  { id: 'scan', title: 'Scan a daily sheet', href: '/scan' },
  { id: 'confirm', title: 'Confirm OCR rows', href: '/scan' },
  { id: 'alcohol', title: 'Add alcohol points', href: '/alcohol' },
  { id: 'approve', title: 'Approve the day', href: '/shifts' },
  { id: 'payroll', title: 'View biweekly payroll', href: '/payroll' },
]

/**
 * Lightweight existence checks for the dashboard onboarding checklist.
 * Six parallel `select id limit 1` reads — cheap on a small dataset.
 */
export async function getOnboardingStatus(): Promise<OnboardingStatus | null> {
  if (!isSupabaseConfigured()) return null

  const supabase = getSupabaseAdmin()
  const hasRow = async (q: PromiseLike<{ data: unknown[] | null }>) => {
    const { data } = await q
    return Array.isArray(data) && data.length > 0
  }

  const [hasEmployee, hasOcr, hasShift, hasAlcohol, hasApproved, hasPeriod] =
    await Promise.all([
      hasRow(supabase.from('employees').select('id').limit(1)),
      hasRow(supabase.from('ocr_extractions').select('id').limit(1)),
      hasRow(supabase.from('shifts').select('id').limit(1)),
      hasRow(supabase.from('alcohol_sales').select('id').limit(1)),
      hasRow(
        supabase.from('daily_sheets').select('id').eq('status', 'approved').limit(1)
      ),
      hasRow(supabase.from('pay_periods').select('id').limit(1)),
    ])

  const doneMap: Record<OnboardingStep['id'], boolean> = {
    roster: hasEmployee,
    scan: hasOcr,
    confirm: hasShift,
    alcohol: hasAlcohol,
    approve: hasApproved,
    payroll: hasPeriod,
  }

  const steps: OnboardingStep[] = STEP_DEFS.map((def) => ({
    ...def,
    done: doneMap[def.id],
  }))

  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    totalCount: steps.length,
  }
}
