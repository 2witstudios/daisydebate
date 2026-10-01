import type { Metadata } from 'next';
import { PrivacyPage } from '../../../../ui/leaderboard/privacy-page/privacy-page';

export const metadata: Metadata = { title: 'Leaderboard privacy' };

/** Public: what the ladder shows, and what it never does. */
export default function LeaderboardPrivacyRoute() {
  return <PrivacyPage />;
}
