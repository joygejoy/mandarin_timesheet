'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Lazy-loaded original sheet photo. The signed-URL request only fires the
 * first time the manager opens the panel; we cache it in component state so
 * subsequent open/close don't re-hit the API.
 */
export function ScanPhotoPanel({ sheetId }: { sheetId: string }) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || state !== 'idle') return
    let aborted = false
    setState('loading')
    setError(null)
    fetch(`/api/sheets/${sheetId}/scan-url`)
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as {
          url?: string | null
          error?: string
        }
        if (aborted) return
        if (!res.ok) {
          setError(json.error ?? `HTTP ${res.status}`)
          setState('error')
          return
        }
        setUrl(json.url ?? null)
        setState('loaded')
      })
      .catch((e) => {
        if (aborted) return
        setError(e instanceof Error ? e.message : 'Network error')
        setState('error')
      })
    return () => {
      aborted = true
    }
  }, [open, state, sheetId])

  function onToggle(ev: React.SyntheticEvent<HTMLDetailsElement>) {
    setOpen(ev.currentTarget.open)
  }

  return (
    <details
      ref={detailsRef}
      onToggle={onToggle}
      className="surface p-4"
    >
      <summary className="cursor-pointer text-sm font-medium text-[color:var(--muted)] hover:text-[color:var(--foreground)]">
        Original sheet photo
      </summary>
      <div className="mt-3">
        {state === 'loading' && (
          <p className="inline-flex items-center gap-2 text-sm text-[color:var(--muted)]">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-[color:var(--accent)]" />
            Loading…
          </p>
        )}
        {state === 'error' && (
          <p className="text-sm text-rose-700 dark:text-rose-300">
            Could not load the photo: {error}
          </p>
        )}
        {state === 'loaded' && !url && (
          <p className="text-sm text-[color:var(--muted)]">No photo stored for this sheet.</p>
        )}
        {state === 'loaded' && url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Scanned daily sign-in/out sheet"
            className="max-h-[80vh] w-full rounded border border-[color:var(--border)] object-contain"
          />
        )}
      </div>
    </details>
  )
}
