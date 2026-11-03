import type { Metadata } from 'next';
import { systemClock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import type { SearchParams } from '../../../features/access/decision';
import { parseRoomDiscoveryQuery } from '../../../features/lobby/discovery-query';
import { requireAccess } from '../../../lib/access';
import { Lobby } from '../../../ui/lobby/lobby';
import { roomListing } from './actions';
import { requestActiveRoom } from '../active-room';
import { ResumeRound } from '../../../ui/active-room/resume-round';
import { LobbyViews, OnlineCount } from '../../../ui/online/lobby-views';
import { OnlinePanel } from '../../../ui/online/online-rail';
import { personActions } from '../online/online-shell';

export const metadata: Metadata = { title: 'Lobby' };
export default async function LobbyPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  const identity = await requireAccess('/lobby', searchParams);
  const actorId =
    identity.state === 'member' ? identity.principal.actorId : null;
  const query = parseRoomDiscoveryQuery(await searchParams);
  if (!query.success) throw createAppError('VALIDATION');
  const [listing, activeRoom] = await Promise.all([
    roomListing(query.data),
    requestActiveRoom(),
  ]);
  if (listing.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  const now = Date.parse(systemClock.now());
  const rooms = (
    <>
      <ResumeRound room={activeRoom} actorId={actorId} />
      <Lobby
        query={query.data}
        rooms={listing.rooms}
        nextCursor={listing.nextCursor}
        retry={listing.retry}
        activeRoom={activeRoom}
        now={now}
      />
    </>
  );
  // A phone has no rail: the Lobby's switch holds the online list instead.
  return identity.state === 'member' ? (
    <LobbyViews
      view={(await searchParams).view === 'rooms' ? 'rooms' : 'online'}
      rooms={rooms}
      online={<OnlinePanel actions={personActions} />}
      onlineCount={<OnlineCount />}
    />
  ) : (
    rooms
  );
}
