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
      <header className="pb-8">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-[color:var(--muted)]">{summary}</p>
      </header>
      <div className="surface border-dashed p-6">
        <p className="text-sm text-[color:var(--muted)]">Up next</p>
        <ul className="mt-3 space-y-1 text-sm">
          {next.map((n) => (
            <li key={n}>– {n}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
