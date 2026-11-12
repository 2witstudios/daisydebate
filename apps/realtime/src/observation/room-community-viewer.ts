import { decideRoomCommunity } from '@daisy/auth/room-community';
import type { RoomCommunityFact } from '@daisy/protocol/room-community';
import type { loadAuthorizationSession } from '@daisy/db/authorization';
import type { SocketPrincipal } from '../registry';
import { contextChannelPermit } from './context-channel-permit';
import type { PermitDecision } from './permits';

/**
 * A current fenced session and Room chat fact grant one shared projection,
 * bounded from read start. It is the HTTP read decision: a Room that has
 * started or closed, or a viewer who lost their standing, is denied at the
 * next evaluation, and the short permit is the longest a tab outlives that.
 */
export function decideRoomCommunityPermit({
  principal,
  session,
  fact,
  contentRevision,
  started,
  now,
  instant,
}: {
  readonly principal: SocketPrincipal;
  readonly session: Awaited<ReturnType<typeof loadAuthorizationSession>>;
  readonly fact: RoomCommunityFact;
  readonly contentRevision: number;
  readonly started: number;
  readonly now: number;
  readonly instant: string;
}): PermitDecision {
  if (!session) return { status: 'denied' };
  return contextChannelPermit({
    session,
    decision: decideRoomCommunity({
      principal,
      account: session.account,
      fact,
      action: 'read',
      now: instant,
    }),
    disclosureRevision: fact.revision,
    contentRevision,
    started,
    now,
    instant,
  });
}
