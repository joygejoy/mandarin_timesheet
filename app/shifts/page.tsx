import { ComingSoon } from '@/app/_components/ComingSoon'

export default function ShiftsPage() {
  return (
    <ComingSoon
      title="Daily shifts"
      summary="Manual entry for a day without scanning. Pick a date, add rows per employee."
      next={['Date picker + pay period assignment', 'Add/edit/delete shift rows', 'Daily summary preview']}
    />
  )
}
