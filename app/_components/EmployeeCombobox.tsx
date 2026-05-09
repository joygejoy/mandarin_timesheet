'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export type ComboboxOption = {
  id: string
  label: string
  sublabel?: string
}

/**
 * Filterable combobox — type to narrow, click or Enter to select.
 * If `allowCustom` (default true) and the typed text doesn't match any
 * option, emits { id: null, label: typed }.
 */
export function EmployeeCombobox({
  options,
  value,
  customLabel,
  onChange,
  placeholder = 'Type a name…',
  className = '',
  disabled = false,
  allowCustom = true,
}: {
  options: ComboboxOption[]
  value: string | null
  customLabel?: string
  onChange: (next: { id: string | null; label: string }) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  allowCustom?: boolean
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)

  const selected = useMemo(() => options.find((o) => o.id === value) ?? null, [options, value])
  const display = open ? query : selected?.label ?? customLabel ?? ''

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, query])

  // "Custom name" footer row index (only present when allowCustom + query has
  // text + no exact match)
  const trimmedQuery = query.trim()
  const exactMatch = filtered.find((o) => o.label.toLowerCase() === trimmedQuery.toLowerCase())
  const customRowVisible = allowCustom && trimmedQuery.length > 0 && !exactMatch
  const totalRows = filtered.length + (customRowVisible ? 1 : 0)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // Keep highlighted in range as the filter changes
  useEffect(() => {
    setHighlighted((h) => Math.max(0, Math.min(h, totalRows - 1)))
  }, [totalRows])

  // Scroll highlighted option into view
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${highlighted}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlighted, open])

  function selectByIndex(i: number) {
    if (i < filtered.length) {
      const opt = filtered[i]
      onChange({ id: opt.id, label: opt.label })
    } else if (customRowVisible && i === filtered.length) {
      onChange({ id: null, label: trimmedQuery })
    }
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      setHighlighted((h) => (totalRows === 0 ? 0 : (h + 1) % totalRows))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) setOpen(true)
      setHighlighted((h) => (totalRows === 0 ? 0 : (h - 1 + totalRows) % totalRows))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (open && totalRows > 0) selectByIndex(highlighted)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setQuery('')
      inputRef.current?.blur()
    }
  }

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        disabled={disabled}
        value={display}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value)
          if (!open) setOpen(true)
          setHighlighted(0)
        }}
        onFocus={() => {
          setOpen(true)
          setQuery('')
          setHighlighted(0)
        }}
        onKeyDown={onKeyDown}
        className="input w-full"
        autoComplete="off"
      />
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full min-w-44 overflow-auto rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] py-1 text-sm shadow-md"
        >
          {filtered.length === 0 && !customRowVisible && (
            <li className="px-3 py-1.5 text-[color:var(--muted)]">No matches</li>
          )}
          {filtered.map((o, i) => (
            <li
              key={o.id}
              data-i={i}
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={(e) => {
                e.preventDefault()
                selectByIndex(i)
              }}
              onMouseEnter={() => setHighlighted(i)}
              className={`cursor-pointer px-3 py-1.5 ${
                i === highlighted ? 'bg-black/5 dark:bg-white/5' : ''
              }`}
            >
              {o.label}
              {o.sublabel && (
                <span className="ml-2 text-xs text-[color:var(--muted)]">{o.sublabel}</span>
              )}
            </li>
          ))}
          {customRowVisible && (
            <li
              data-i={filtered.length}
              role="option"
              aria-selected={highlighted === filtered.length}
              onMouseDown={(e) => {
                e.preventDefault()
                selectByIndex(filtered.length)
              }}
              onMouseEnter={() => setHighlighted(filtered.length)}
              className={`cursor-pointer border-t border-[color:var(--border)] px-3 py-1.5 italic ${
                highlighted === filtered.length ? 'bg-black/5 dark:bg-white/5' : ''
              }`}
            >
              Use "{trimmedQuery}" (not in roster)
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
