import type { Metadata } from 'next';
import { createAppError } from '@daisy/errors';
import type { SearchParams } from '../../../features/access/decision';
import { parseLobbyQuery } from '../../../features/lobby/discovery-query';
import { requireAccess } from '../../../lib/access';
import { Lobby } from '../../../ui/lobby/lobby';
import { roomListing } from './actions';

export const metadata: Metadata = { title: 'Lobby' };
export default async function LobbyPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/lobby', searchParams);
  const query = parseLobbyQuery(await searchParams);
  if (!query.success) throw createAppError('VALIDATION');
  const listing = await roomListing(query.data.list);
  if (listing.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  return (
    <Lobby
      query={query.data}
      rooms={listing.rooms}
      nextCursor={listing.nextCursor}
      retry={listing.retry}
      activeRoom={null}
    />
  );
}
