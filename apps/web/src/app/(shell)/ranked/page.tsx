import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { requireAccess } from '../../../lib/access';
import { RouteShell } from '../../ui/route-shell';

export const metadata: Metadata = { title: 'Ranked' };

export default async function RankedPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/ranked', searchParams);
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
