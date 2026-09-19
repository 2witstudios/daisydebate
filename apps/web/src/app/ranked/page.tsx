import type { Metadata } from 'next';
import { RouteShell } from '../ui/route-shell';

export const metadata: Metadata = { title: 'Ranked' };

export default function RankedPage() {
  return (
    <RouteShell
      title="Ranked"
      lede="Rated competitive debates with seasonal standing."
      planned={[
        'Rating-adjacent matchmaking',
        'Season ladders and decay policy',
        'Ranked eligibility and conduct rules',
      ]}
    />
  );
}
