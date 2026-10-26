import type { Metadata } from 'next';
import { systemClock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import type { SearchParams } from '../../../features/access/decision';
import { parseRoomDiscoveryQuery } from '../../../features/lobby/discovery-query';
import { requireAccess } from '../../../lib/access';
import { Lobby } from '../../../ui/lobby/lobby';
import { roomListing } from './actions';
import { requestActiveRoom } from '../active-room';

export const metadata: Metadata = { title: 'Lobby' };
export default async function LobbyPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/lobby', searchParams);
  const query = parseRoomDiscoveryQuery(await searchParams);
  if (!query.success) throw createAppError('VALIDATION');
  const [listing, activeRoom] = await Promise.all([
    roomListing(query.data),
    requestActiveRoom(),
  ]);
  if (listing.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  const now = Date.parse(systemClock.now());
  return (
    <Lobby
      query={query.data}
      rooms={listing.rooms}
      nextCursor={listing.nextCursor}
      retry={listing.retry}
      activeRoom={activeRoom}
      now={now}
    />
  );
}
