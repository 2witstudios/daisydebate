import type { Metadata } from 'next';
import type { SearchParams } from '../../features/access/decision';
import { requireAccess } from '../../lib/access';
import { RouteShell } from '../ui/route-shell';

export const metadata: Metadata = { title: 'Recordings' };

export default async function RecordingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/recordings', 'participant', searchParams);
  return (
    <RouteShell
      title="Recordings"
      lede="Debate recordings and replay metadata."
      planned={[
        'Recording catalog per debate',
        'Replay with phase timeline',
        'Retention and visibility policy',
      ]}
    />
  );
}
