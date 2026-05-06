'use client'

import { useState } from 'react'

export function PushToSheetsButton({ periodId }: { periodId: string }) {
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'pending' }
    | { kind: 'ok'; url: string; tabName: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  async function push() {
    setStatus({ kind: 'pending' })
    try {
      const res = await fetch(`/api/payroll/${periodId}/sheets`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setStatus({ kind: 'ok', url: json.url, tabName: json.tabName })
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={push}
        disabled={status.kind === 'pending'}
        className="btn-secondary"
      >
        {status.kind === 'pending' ? 'Pushing…' : 'Push to Sheets'}
      </button>
      {status.kind === 'ok' && (
        <a
          className="text-xs text-zinc-600 underline dark:text-zinc-400"
          href={status.url}
          target="_blank"
          rel="noreferrer"
        >
          Open “{status.tabName}”
        </a>
      )}
      {status.kind === 'error' && (
        <span className="text-xs text-rose-600 dark:text-rose-400" title={status.message}>
          {status.message.length > 60 ? status.message.slice(0, 60) + '…' : status.message}
        </span>
      )}
    </div>
  )
}
