/**
 * Normalize an employee name for duplicate detection. Returns a key that
 * collapses common spelling variants so re-imports merge cleanly:
 *
 *   "Lisa F"   →  "lisa f"
 *   "lisa  f." →  "lisa f"
 *   "LISA F"   →  "lisa f"
 *   "Lisa-F"   →  "lisa f"
 *   "Lísa F"   →  "lisa f"   (NFKD strips diacritics)
 *
 * The result is NOT meant for display — only as a dedupe key.
 */
export function normalizeEmployeeName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
