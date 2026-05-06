import 'server-only'

/**
 * Extract text from a PDF using pdfjs-dist's legacy Node build.
 * Returns the concatenated text of every page (one page per line group).
 * Throws if the PDF has no text layer (image-only scan).
 */
export async function pdfToText(buf: Buffer): Promise<string> {
  // The legacy build runs on Node without DOM polyfills, but it still tries
  // to spin up a Worker by default. Bundlers (Turbopack) can fail to resolve
  // the worker chunk at runtime, so point at the worker file explicitly and
  // also fall back to in-process execution if the worker import fails.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workerUrl = (await import('pdfjs-dist/legacy/build/pdf.worker.mjs' as any)) as unknown
    void workerUrl // referenced so bundler keeps it; pdfjs picks it up from globals
  } catch {
    // ignore — fall through to noWorker mode
  }
  // GlobalWorkerOptions on Node points at the bundled worker if available;
  // when not, isOffscreenCanvasSupported=false + verbosity=0 makes pdfjs
  // run synchronously in-thread.
  if (pdfjsLib.GlobalWorkerOptions) {
    try {
      // Resolve through Node module resolution (avoids Turbopack's chunk path)
      const { fileURLToPath } = await import('node:url')
      pdfjsLib.GlobalWorkerOptions.workerSrc = fileURLToPath(
        new URL(
          '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
          import.meta.url
        )
      )
    } catch {
      /* noop */
    }
  }

  const doc = await pdfjsLib.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise

  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    // Items can be TextItem (with str) or TextMarkedContent. Keep only strs.
    const lineMap = new Map<number, string[]>()
    for (const item of content.items) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const it = item as any
      if (typeof it.str !== 'string' || !it.str) continue
      // Group items by approximate y position so we reconstruct lines.
      const y = Math.round(it.transform?.[5] ?? 0)
      if (!lineMap.has(y)) lineMap.set(y, [])
      lineMap.get(y)!.push(it.str)
    }
    // PDF y coordinates increase upward; sort descending so top-of-page is first.
    const pageLines = [...lineMap.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, parts]) => parts.join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    pages.push(pageLines.join('\n'))
    page.cleanup()
  }
  await doc.destroy()

  const text = pages.join('\n').trim()
  if (text.length === 0) {
    throw new Error(
      'No text found in this PDF. Looks like a scanned image — take a screenshot of the page and upload that instead.'
    )
  }
  return text
}
