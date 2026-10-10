import type { Metadata } from 'next';
import { createAppError } from '@daisy/errors';
import type { SearchParams } from '../../../features/access/decision';
import { roomListQuerySchema } from '@daisy/protocol';
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
  const raw = await searchParams;
  const query = roomListQuerySchema.safeParse({
    ...raw,
    ...(raw.pageSize === undefined
      ? {}
      : {
          pageSize:
            typeof raw.pageSize === 'string' &&
            /^(?:[1-9]|[1-4][0-9]|50)$/.test(raw.pageSize)
              ? Number(raw.pageSize)
              : NaN,
        }),
  });
  if (!query.success) throw createAppError('VALIDATION');
  const listing = await roomListing(query.data);
  if (listing.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  return (
    <AssemblyLobby
      rooms={listing.rooms}
      query={query.data}
      nextCursor={listing.nextCursor}
      retry={listing.retry}
    />
  );
}
