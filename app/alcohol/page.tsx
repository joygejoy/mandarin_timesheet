import { ComingSoon } from '@/app/_components/ComingSoon'

export default function AlcoholPage() {
  return (
    <ComingSoon
      title="Alcohol sales"
      summary="Daily drink point tally per server. Powers the biweekly leaderboard."
      next={['Per-day point entry', 'Top 3 leaderboard for the current pay period', 'Tally history per employee']}
    />
  )
}
