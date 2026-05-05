import { ComingSoon } from '@/app/_components/ComingSoon'

export default function ScanPage() {
  return (
    <ComingSoon
      title="Scan a daily sheet"
      summary="Live capture with edge detection, then GPT-4o vision extracts shifts into a side-by-side review table."
      next={[
        'Mobile camera capture with jscanify (live corner detection)',
        'GPT-4o vision extraction with confidence flags',
        'Editable review table with original photo on the left',
        'Approve into the current pay period',
      ]}
    />
  )
}
