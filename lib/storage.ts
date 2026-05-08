import 'server-only'
import { getSupabaseAdmin } from '@/lib/supabase/server'

export const SCANS_BUCKET = 'scans'

let bucketEnsured = false

/**
 * Make sure the private "scans" bucket exists. Idempotent and cached for the
 * server runtime — first call may create it; subsequent calls are no-ops.
 */
async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.storage.listBuckets()
  if (error) throw new Error(`Storage list failed: ${error.message}`)
  if (!data?.some((b) => b.name === SCANS_BUCKET)) {
    const { error: createErr } = await supabase.storage.createBucket(SCANS_BUCKET, {
      public: false,
      fileSizeLimit: 12 * 1024 * 1024,
    })
    if (createErr && !/already exists/i.test(createErr.message)) {
      throw new Error(`Storage createBucket failed: ${createErr.message}`)
    }
  }
  bucketEnsured = true
}

/**
 * Upload a raw scan image to the private scans bucket. Returns the storage
 * path (e.g. "2026-05-07/1234567890-photo.jpg") which is then saved on the
 * daily_sheets row. Throws on hard failures so the caller can surface the
 * error to the user.
 */
export async function uploadScanImage(args: {
  bytes: Buffer
  mimeType: string
  originalFilename: string
}): Promise<string> {
  await ensureBucket()
  const supabase = getSupabaseAdmin()
  const datePart = new Date().toISOString().slice(0, 10)
  const safeName = args.originalFilename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80)
  const path = `${datePart}/${Date.now()}-${safeName}`
  const { error } = await supabase.storage
    .from(SCANS_BUCKET)
    .upload(path, args.bytes, { contentType: args.mimeType, upsert: false })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)
  return path
}

/**
 * Generate a short-lived signed URL for displaying a stored scan in the UI.
 * Returns null if the path is empty or the signing failed.
 */
export async function getScanSignedUrl(
  path: string | null | undefined,
  expiresInSec = 60 * 60
): Promise<string | null> {
  if (!path) return null
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase.storage
    .from(SCANS_BUCKET)
    .createSignedUrl(path, expiresInSec)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}
