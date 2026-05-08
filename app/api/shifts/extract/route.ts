import { NextRequest, NextResponse } from 'next/server'
import {
  extractShiftsFromImage,
  isOpenAIConfigured,
  OpenAINotConfiguredError,
} from '@/lib/openai'
import { getSupabaseAdmin, isSupabaseConfigured } from '@/lib/supabase/server'
import { uploadScanImage } from '@/lib/storage'

export const runtime = 'nodejs'
export const maxDuration = 90

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export async function POST(request: NextRequest) {
  if (!isOpenAIConfigured()) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not set in .env.local. Add it and restart the dev server.' },
      { status: 503 }
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with a "file" field.' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 })
  }
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}.` }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${Math.round(file.size / 1024 / 1024)} MB). Max 10 MB.` },
      { status: 413 }
    )
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const base64 = buf.toString('base64')

  // Pass the active roster to the model so it picks canonical spellings
  // instead of guessing at messy handwriting.
  let roster: { name: string; role: string | null }[] = []
  if (isSupabaseConfigured()) {
    try {
      const supabase = getSupabaseAdmin()
      const { data } = await supabase
        .from('employees')
        .select('full_name, role')
        .eq('active', true)
      roster = (data ?? []).map((e) => ({ name: e.full_name, role: e.role }))
    } catch {
      // Roster fetch is best-effort. Extraction works fine without it.
    }
  }

  try {
    const { sheet } = await extractShiftsFromImage({
      imageBase64: base64,
      mimeType: file.type,
      roster,
    })
    let scan_image_path: string | null = null
    if (isSupabaseConfigured()) {
      try {
        scan_image_path = await uploadScanImage({
          bytes: buf,
          mimeType: file.type,
          originalFilename: file.name,
        })
      } catch (uploadErr) {
        // Don't fail the OCR response if storage upload hiccups; the manager
        // can still review and save shifts. The path stays null.
        console.warn('[scan/extract] image upload failed:', uploadErr)
      }
    }
    return NextResponse.json({ sheet, scan_image_path })
  } catch (err) {
    if (err instanceof OpenAINotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    const e = err as { status?: number; code?: string; message?: string }
    const status = typeof e.status === 'number' ? e.status : 502
    const message = friendlyOpenAIError(e)
    console.error('[scan/extract] OpenAI error:', e)
    return NextResponse.json({ error: message, code: e.code }, { status })
  }
}

function friendlyOpenAIError(e: { code?: string; message?: string; status?: number }): string {
  if (e.code === 'insufficient_quota') {
    return 'Your OpenAI account has no credits. Add a payment method and at least $5 in credits at https://platform.openai.com/settings/organization/billing.'
  }
  if (e.code === 'invalid_api_key' || e.status === 401) {
    return 'OpenAI rejected the API key. Check OPENAI_API_KEY in .env.local and restart the dev server.'
  }
  if (e.status === 429) {
    return 'OpenAI rate-limited this request. Wait a moment and try again.'
  }
  return e.message ?? 'Unknown OpenAI error'
}
