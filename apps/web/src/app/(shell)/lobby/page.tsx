import type { Metadata } from 'next';
import { systemClock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { lobbyOf } from '@daisy/protocol';
import type { SearchParams } from '../../../features/access/decision';
import { parseRoomDiscoveryQuery } from '../../../features/lobby/discovery-query';
import { requireAccess } from '../../../lib/access';
import { requestMemberDivision } from '../../../lib/request-session';
import { Lobby } from '../../../ui/lobby/lobby';
import { hostedRoomsRead, roomListing } from './actions';
import { requestActiveRoom } from '../active-room';
import { ResumeRound } from '../../../ui/active-room/resume-round';
import { HostedRooms } from '../../../ui/active-room/hosted-rooms';
import { LobbyViews, OnlineCount } from '../../../ui/people/lobby-views';
import { PeoplePanel } from '../../../ui/people/people-rail';
import { personActions } from '../people/people-shell';

export const metadata: Metadata = { title: 'Lobby' };
export default async function LobbyPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  const identity = await requireAccess('/lobby', searchParams);
  const actorId =
    identity.state === 'member' ? identity.principal.actorId : null;
  const parsed = parseRoomDiscoveryQuery(await searchParams);
  if (!parsed.success) throw createAppError('VALIDATION');
  // Only the rows' actions and the landing lobby read it; the Room's own seat
  // check decides.
  const viewerDivision = await requestMemberDivision().catch(() => null);
  // A member lands in their own lobby unless the URL names one (ADR 0156).
  const query = {
    ...parsed.data,
    division: parsed.data.division ?? lobbyOf({ division: viewerDivision }),
  };
  const [listing, activeRoom, hosted] = await Promise.all([
    roomListing(query),
    requestActiveRoom(),
    actorId === null ? [] : hostedRoomsRead(),
  ]);
  if (listing.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  const now = Date.parse(systemClock.now());
  const rooms = (
    <>
      <ResumeRound room={activeRoom} actorId={actorId} />
      <HostedRooms rooms={hosted} />
      <Lobby
        query={query}
        rooms={listing.rooms}
        nextCursor={listing.nextCursor}
        retry={listing.retry}
        activeRoom={activeRoom}
        now={now}
        viewer={{ actorId, division: viewerDivision }}
      />
    </>
  );
  // A phone has no rail: the Lobby's switch holds the people list instead.
  return identity.state === 'member' ? (
    <LobbyViews
      view={(await searchParams).view === 'rooms' ? 'rooms' : 'people'}
      rooms={rooms}
      people={<PeoplePanel actions={personActions} />}
      onlineCount={<OnlineCount />}
    />
  ) : (
    rooms
  );
}
