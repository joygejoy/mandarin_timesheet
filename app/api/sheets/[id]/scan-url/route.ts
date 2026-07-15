import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server'
import { getScanSignedUrl } from '@/lib/storage'
import { getSession } from '@/lib/auth'

export const runtime = 'nodejs'

/**
 * Returns a short-lived signed URL for the daily sheet's stored scan image.
 * Used by the lazy-loaded photo dropdown so the URL isn't generated on every
 * page load — only when the manager actually opens the photo panel.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session || session.pending) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Missing sheet id' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('daily_sheets')
    .select('scan_image_path')
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Sheet not found' }, { status: 404 })
  if (!data.scan_image_path) return NextResponse.json({ url: null })

  const url = await getScanSignedUrl(data.scan_image_path)
  if (!url) return NextResponse.json({ error: 'Could not sign URL' }, { status: 502 })
  return NextResponse.json({ url })
}
