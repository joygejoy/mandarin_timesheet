import { NextRequest, NextResponse } from 'next/server'
import {
  extractShiftsFromImage,
  isOpenAIConfigured,
  OpenAINotConfiguredError,
} from '@/lib/openai'

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

  try {
    const { sheet } = await extractShiftsFromImage({
      imageBase64: base64,
      mimeType: file.type,
    })
    return NextResponse.json({ sheet })
  } catch (err) {
    if (err instanceof OpenAINotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    const message = err instanceof Error ? err.message : 'Unknown OpenAI error'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
