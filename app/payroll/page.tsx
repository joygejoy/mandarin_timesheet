import { ComingSoon } from '@/app/_components/ComingSoon'

export default function PayrollPage() {
  return (
    <ComingSoon
      title="Payroll"
      summary="Biweekly rollup of approved daily sheets. Export to Sheets, CSV, PDF."
      next={['Pay period management', 'Per-employee hours and gross pay', 'Alcohol totals by day', 'Sheets / CSV export']}
    />
  )
}
