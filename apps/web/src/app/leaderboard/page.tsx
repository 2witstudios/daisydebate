import type { Metadata } from 'next';
import { RouteShell } from '../ui/route-shell';

export const metadata: Metadata = { title: 'Leaderboard' };

export default function LeaderboardPage() {
  return (
    <RouteShell
      title="Leaderboard"
      lede="Ratings and rankings across formats."
      planned={[
        'Per-format rating ladders',
        'Seasonal snapshots',
        'Provisional and established rating display',
      ]}
    />
  );
}
