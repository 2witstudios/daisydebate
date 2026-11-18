import { eventBallotAccess } from '../round-ballots/audience';
import {
  authorize,
  type AccountAuthorizationFact,
} from '@daisy/auth/authorization';
import type { Database, RoundRoomAuthority } from '@daisy/db';
import { eventRoomOwner } from '../tab/event-room-direction';
import { readRoundOpening, roundWaitingOn } from '@daisy/debate-engine';
import type { LaunchedRound } from '@daisy/protocol';
const canRead = (
  caller: { readonly userId: string; readonly actorId: string },
  round: LaunchedRound,
  account: AccountAuthorizationFact | null,
  authority: RoundRoomAuthority,
  capability:
    'round.read' | 'round.transcript.read' | 'round.observe.undelayed',
) => {
  if (!authority || authority.kind === 'unavailable') return false;
  const direction = authority.kind === 'event' ? authority.direction : null;
  const owner = direction
    ? eventRoomOwner(direction, authority.checkedAt)
    : null;
  if (authority.kind === 'event' && (!direction || !owner)) return false;
  return authorize({
    principal: { kind: 'user', ...caller },
    capability,
    context: direction
      ? {
          account: direction.authorization.account,
          grants: direction.authorization.grants,
          now: authority.checkedAt,
        }
      : { account, now: authority.checkedAt },
    resource: {
      kind: 'round',
      roundId: round.id,
      createdByActorId: round.hostActorId,
      visibility: round.visibility,
      status: round.status,
      participants: round.participants,
      revision: round.version,
      ...(owner ? { owner } : {}),
    },
  }).allow;
};

/** One current transcript audience policy for live and completed reads. */
export const canReadTranscript = (
  caller: { readonly userId: string; readonly actorId: string },
  round: LaunchedRound,
  account: AccountAuthorizationFact | null,
  authority: RoundRoomAuthority,
) => canRead(caller, round, account, authority, 'round.transcript.read');

export const canReadRound = (
  caller: { readonly userId: string; readonly actorId: string },
  round: LaunchedRound,
  account: AccountAuthorizationFact | null,
  authority: RoundRoomAuthority,
) => canRead(caller, round, account, authority, 'round.read');

/** A seatless host's live room (WATCH-6); a seated host reads through the seat. */
export const canObserveUndelayed = (
  caller: { readonly userId: string; readonly actorId: string },
  round: LaunchedRound,
  account: AccountAuthorizationFact | null,
  authority: RoundRoomAuthority,
) => canRead(caller, round, account, authority, 'round.observe.undelayed');

/** The Round as this caller may see it: every read of it, one composition. */
export const roundViewReader =
  (
    store: Pick<Database, 'readLaunchedRound'> & {
      readonly broadcasts: Pick<Database['broadcasts'], 'conversationHeld'>;
    },
  ) =>
  async (
    caller: { readonly userId: string; readonly actorId: string },
    roundId: string,
  ) => {
    let viewerIsUndelayedObserver = false;
    const view = await store.readLaunchedRound(
      roundId,
      caller,
      (round, account, authority) => {
        viewerIsUndelayedObserver = canObserveUndelayed(
          caller,
          round,
          account,
          authority,
        );
        return canReadRound(caller, round, account, authority);
      },
      readRoundOpening,
      roundWaitingOn,
      (owner) => eventBallotAccess(caller, owner).parts.includes('decision'),
    );
    return {
      ...view,
      viewerIsUndelayedObserver,
      conversationHeld: await store.broadcasts.conversationHeld(roundId),
    };
  };
