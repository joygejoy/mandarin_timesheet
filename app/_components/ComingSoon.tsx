export function ComingSoon({
  title,
  summary,
  next,
}: {
  title: string
  summary: string
  next: string[]
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <header className="pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-zinc-500">{summary}</p>
      </header>
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Up next</p>
        <ul className="mt-3 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
          {next.map((n) => (
            <li key={n}>– {n}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
