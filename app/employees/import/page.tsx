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
  // Include inactive employees so the preview can flag them as duplicates too —
  // matches the dedupe rule applied at save time.
  const { data } = await supabase.from('employees').select('full_name')
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
      <header className="pb-8">
        <Link href="/employees" className="text-sm text-[color:var(--muted)] hover:text-[color:var(--foreground)]">
          ← Employees
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Import from a sheet</h1>
        <p className="mt-1 text-sm text-[color:var(--muted)]">
          Upload a daily sign-in sheet, CSV, or XLSX. Names are extracted and dedupe is
          case- and punctuation-insensitive — re-importing won't create duplicates.
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
        Get a key at{' '}
        <a className="underline" href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
          platform.openai.com/api-keys
        </a>
        . Each scan costs roughly $0.01.
      </p>
    </div>
  )
}
