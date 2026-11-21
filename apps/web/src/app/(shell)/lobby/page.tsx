import type { Metadata } from 'next';
import { nowMs, systemClock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { defaultStandingLobby } from '@daisy/protocol/lobby/eligibility';
import type { SearchParams } from '../../../features/access/decision';
import { parseRoomDiscoveryQuery } from '../../../features/lobby/discovery-query';
import { requireAccess } from '../../../lib/access';
import {
  requestCompetitionAgeBand,
  requestOfficialStandingLobbies,
  requestStudentRoundIds,
} from '../../../lib/request-session';
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
  const [ageBand, lobbies] = await Promise.all([
    requestCompetitionAgeBand(),
    requestOfficialStandingLobbies(),
  ]);
  const lobby = parsed.data.lobbyId
    ? lobbies.find(({ id }) => id === parsed.data.lobbyId)
    : defaultStandingLobby(lobbies, ageBand);
  const query = { ...parsed.data, lobbyId: lobby?.id ?? parsed.data.lobbyId };
  const [listing, activeRoom, hosted, studentRoundIds] = await Promise.all([
    roomListing(query),
    requestActiveRoom(),
    actorId === null ? [] : hostedRoomsRead(),
    identity.state === 'member' && lobby?.ageRule === 'under-18'
      ? requestStudentRoundIds(identity.principal)
      : [],
  ]);
  if (listing.kind !== 'found') throw createAppError('INFRASTRUCTURE');
  const now = nowMs(systemClock);
  const rooms = (
    <>
      <ResumeRound room={activeRoom} actorId={actorId} />
      <HostedRooms rooms={hosted} />
      <Lobby
        query={query}
        lobbies={lobbies}
        rooms={listing.rooms}
        nextCursor={listing.nextCursor}
        retry={listing.retry}
        activeRoom={activeRoom}
        now={now}
        viewer={{ actorId, ageBand, studentRoundIds }}
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
