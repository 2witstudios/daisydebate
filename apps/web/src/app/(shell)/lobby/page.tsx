import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { requireAccess } from '../../../lib/access';
import { RouteShell } from '../../ui/route-shell';

export const metadata: Metadata = { title: 'Lobby' };

export default async function LobbyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/lobby', searchParams);
  return (
    <RouteShell
      title="Lobby"
      lede="Open tables, queues, and direct challenges."
      planned={[
        'Presence-aware open tables',
        'Matchmaking queues per format',
        'Challenge acceptance with expiry',
      ]}
    />
  );
}
