import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { listRooms } from '../../../features/lobby/list-rooms';
import { parseLobbyQuery } from '../../../features/lobby/query';
import { requireAccess } from '../../../lib/access';
import { Lobby } from '../../../ui/lobby/lobby';

export const metadata: Metadata = { title: 'Lobby' };

export default async function LobbyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/lobby', searchParams);
  const query = parseLobbyQuery(await searchParams);
  const now = systemClock.now();
  return <Lobby listing={listRooms(query, now)} query={query} now={now} />;
}
