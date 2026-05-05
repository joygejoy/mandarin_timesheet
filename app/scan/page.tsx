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
      <header className="pb-6">
        <Link href="/shifts" className="text-sm text-zinc-500 hover:underline">
          ← Daily shifts
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Scan a daily sheet</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Upload a photo, GPT-4o extracts shifts, you correct anything fuzzy, then approve into a daily sheet.
        </p>
      </header>
      {children}
    </div>
  )
}

function OpenAINotice() {
  return (
    <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <p className="font-medium">OpenAI key missing.</p>
      <p className="mt-1">
        Add <code>OPENAI_API_KEY</code> to <code>.env.local</code> and restart the dev server.
        Each scan costs roughly $0.01 on gpt-4o.
      </p>
    </div>
  )
}
