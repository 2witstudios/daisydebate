import type { Metadata } from 'next';
import { createAppError } from '@daisy/errors';
import type { SearchParams } from '../../../features/access/decision';
import { parseRoomDiscoveryQuery } from '../../../features/lobby/discovery-query';
import { requireAccess } from '../../../lib/access';
import { AssemblyLobby } from '../../../ui/lobby/assembly-lobby';
import { roomListing } from './actions';
import { requestActiveRoom } from '../../../lib/active-room';

export const metadata: Metadata = { title: 'Lobby' };
export default async function LobbyPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/lobby', searchParams);
  const raw = await searchParams;
  const query = parseRoomDiscoveryQuery(raw);
  if (!query.success) throw createAppError('VALIDATION');
  const [listing, activeRoom] = await Promise.all([
    roomListing(query.data),
    requestActiveRoom(),
  ]);
  if (listing.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  return (
    <AssemblyLobby
      rooms={listing.rooms}
      query={query.data}
      nextCursor={listing.nextCursor}
      retry={listing.retry}
      activeRoom={activeRoom}
    />
  );
}
