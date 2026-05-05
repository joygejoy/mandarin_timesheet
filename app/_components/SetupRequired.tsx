export function SetupRequired() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <p className="font-medium">Supabase isn’t connected yet.</p>
      <ol className="mt-3 list-decimal space-y-1 pl-5">
        <li>
          Create a free Supabase project at{' '}
          <a className="underline" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">
            supabase.com
          </a>
          .
        </li>
        <li>
          Copy <code>.env.local.example</code> to <code>.env.local</code> and fill in your project URL and anon key.
        </li>
        <li>
          Open the SQL editor and run <code>supabase/migrations/0001_init.sql</code>.
        </li>
        <li>Restart the dev server.</li>
      </ol>
    </div>
  )
}
