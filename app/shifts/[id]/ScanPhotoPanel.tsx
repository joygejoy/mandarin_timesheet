'use client'

import { useState } from 'react'

/**
 * Lazy-renders the original sheet photo inside a <details> panel.
 * The signed URL is pre-generated server-side (page.tsx), so there is no
 * extra API round-trip — the image starts loading as soon as the panel opens.
 */
export function ScanPhotoPanel({ url }: { url: string | null }) {
  const [open, setOpen] = useState(false)

  if (!url) return null

  return (
    <details
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="surface p-4"
    >
      <summary className="cursor-pointer text-sm font-medium text-[color:var(--muted)] hover:text-[color:var(--foreground)]">
        Original sheet photo
      </summary>
      <div className="mt-3">
        {open && (
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
