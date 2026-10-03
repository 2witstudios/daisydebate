import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { listMyDebates } from '../../../features/debates/list-my-debates';
import { parseDebatesQuery } from '../../../features/debates/list';
import { requireAccess } from '../../../lib/access';
import { DebatesPage } from '../../../ui/debates/debates-page/debates-page';

export const metadata: Metadata = { title: 'My debates' };

export default async function DebatesRoute({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/debates', searchParams);
  const query = parseDebatesQuery(await searchParams);
  const now = systemClock.now();
  return (
    <DebatesPage listing={listMyDebates(query, now)} query={query} now={now} />
  );
}
