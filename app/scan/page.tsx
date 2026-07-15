import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase/server'
import { isOpenAIConfigured } from '@/lib/openai'
import { getSession } from '@/lib/auth'
import { SetupRequired } from '@/app/_components/SetupRequired'
import { PageHero } from '@/app/_components/PageHero'
import { ScanClient } from './ScanClient'
import type { Employee } from '@/lib/types/db'

export const dynamic = 'force-dynamic'

export default async function ScanPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Shell>
        <SetupRequired />
      </Shell>
    )
  }

  const session = await getSession()
  // Non-admin users are hard-locked to their own department here — no peek
  // toggle, unlike Dashboard/Shifts/Payroll (see lib/permissions.ts).
  const lockedDepartment =
    session && session.department !== 'all' ? session.department : null

  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('employees')
    .select('*')
    .eq('active', true)
    .order('full_name', { ascending: true })

  return (
    <Shell>
      {!isOpenAIConfigured() && <OpenAINotice />}
      <ScanClient employees={(data ?? []) as Employee[]} lockedDepartment={lockedDepartment} />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl">
      <PageHero
        eyebrow="Daily · Scan"
        title="Scan a daily sheet"
        subtitle="Upload a photo, GPT-4o extracts shifts, you correct anything fuzzy, then approve into a daily sheet."
        backLink={{ href: '/shifts', label: 'Daily shifts' }}
      />
      {children}
    </div>
  )
}

function OpenAINotice() {
  return (
    <div className="surface mb-6 border-l-4 border-l-[color:var(--primary)] p-4 text-sm">
      <p className="eyebrow mb-1">Setup needed</p>
      <p className="font-medium">OpenAI key missing.</p>
      <p className="mt-1 text-[color:var(--muted)]">
        Add <code>OPENAI_API_KEY</code> to <code>.env.local</code> and restart the dev server.
        Each scan costs roughly $0.01 on gpt-4o.
      </p>
    </div>
  )
}
