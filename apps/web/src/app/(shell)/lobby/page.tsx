import type { Metadata } from 'next';
import { createAppError } from '@daisy/errors';
import type { SearchParams } from '../../../features/access/decision';
import { parseLobbyQuery } from '../../../features/lobby/query';
import { requireAccess } from '../../../lib/access';
import { AssemblyLobby } from '../../../ui/lobby/assembly-lobby';
import { roomListing } from './actions';

export const metadata: Metadata = { title: 'Lobby' };
export default async function LobbyPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/lobby', searchParams);
  const listing = await roomListing();
  if (listing.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  return (
    <AssemblyLobby
      rooms={listing.rooms}
      query={parseLobbyQuery(await searchParams).q}
    />
  );
}
