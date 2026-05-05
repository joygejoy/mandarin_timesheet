import Link from 'next/link'
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase/server'
import { isOpenAIConfigured } from '@/lib/openai'
import { SetupRequired } from '@/app/_components/SetupRequired'
import { ImportClient } from './ImportClient'

export const dynamic = 'force-dynamic'

export default async function ImportEmployeesPage() {
  if (!isSupabaseConfigured()) {
    return (
      <Shell>
        <SetupRequired />
      </Shell>
    )
  }

  const supabase = getSupabaseAdmin()
  const { data } = await supabase.from('employees').select('full_name').eq('active', true)
  const existingNames = (data ?? []).map((e) => e.full_name)

  return (
    <Shell>
      {!isOpenAIConfigured() && <OpenAINotice />}
      <ImportClient existingNames={existingNames} />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl">
      <header className="pb-6">
        <Link href="/employees" className="text-sm text-zinc-500 hover:underline">
          ← Employees
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Import from a sheet</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Upload a daily sign-in sheet. GPT-4o pulls out distinct names so you can review,
          edit defaults, and bulk-add to the roster.
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
        Get a key at{' '}
        <a className="underline" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
          platform.openai.com/api-keys
        </a>
        . Each scan costs roughly $0.01.
      </p>
    </div>
  )
}
