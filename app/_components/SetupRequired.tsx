export function SetupRequired() {
  return (
    <div className="surface border-l-2 border-l-amber-500 p-5 text-sm">
      <p className="font-medium">Supabase isn't connected yet.</p>
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
