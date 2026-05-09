import Link from 'next/link'
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase/server'
import { isOpenAIConfigured } from '@/lib/openai'
import { SetupRequired } from '@/app/_components/SetupRequired'
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

  const supabase = getSupabaseAdmin()
  const { data } = await supabase
    .from('employees')
    .select('*')
    .eq('active', true)
    .order('full_name', { ascending: true })

  return (
    <Shell>
      {!isOpenAIConfigured() && <OpenAINotice />}
      <ScanClient employees={(data ?? []) as Employee[]} />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl">
      <header className="pb-8">
        <Link href="/shifts" className="text-sm text-[color:var(--muted)] hover:text-[color:var(--foreground)]">
          ← Daily shifts
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Scan a daily sheet</h1>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          Upload a photo, GPT-4o extracts shifts, you correct anything fuzzy, then approve into a daily sheet.
        </p>
      </header>
      {children}
    </div>
  )
}

function OpenAINotice() {
  return (
    <div className="mb-6 surface border-l-2 border-l-amber-500 p-4 text-sm">
      <p className="font-medium">OpenAI key missing.</p>
      <p className="mt-1">
        Add <code>OPENAI_API_KEY</code> to <code>.env.local</code> and restart the dev server.
        Each scan costs roughly $0.01 on gpt-4o.
      </p>
    </div>
  )
}
