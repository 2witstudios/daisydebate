import { eventBallotAccess } from '../round-ballots/audience';
import {
  authorize,
  type AccountAuthorizationFact,
} from '@daisy/auth/authorization';
import type { YouthLiveFact } from '@daisy/auth/live-audience';
import type { Database, RoundRoomAuthority } from '@daisy/db';
import { isAppError } from '@daisy/errors';
import type { LinkedAdultsOf } from '../spectating/linked-adults';
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
  youth: YouthLiveFact | null,
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
      youth,
    },
  }).allow;
};

/**
 * One current transcript audience policy for live and completed reads: the
 * seats, and a Youth Round's linked adults when `youth` names them (ADR 0155).
 */
export const canReadTranscript = (
  caller: { readonly userId: string; readonly actorId: string },
  round: LaunchedRound,
  account: AccountAuthorizationFact | null,
  authority: RoundRoomAuthority,
  youth: YouthLiveFact | null = null,
) => canRead(caller, round, account, authority, 'round.transcript.read', youth);

export const canReadRound = (
  caller: { readonly userId: string; readonly actorId: string },
  round: LaunchedRound,
  account: AccountAuthorizationFact | null,
  authority: RoundRoomAuthority,
) => canRead(caller, round, account, authority, 'round.read', null);

/**
 * A seatless host's live room (WATCH-6), and a youth debater's linked adult's
 * on a Youth Round when `youth` names them (ADR 0155); a seat reads through
 * the seat.
 */
export const canObserveUndelayed = (
  caller: { readonly userId: string; readonly actorId: string },
  round: LaunchedRound,
  account: AccountAuthorizationFact | null,
  authority: RoundRoomAuthority,
  youth: YouthLiveFact | null = null,
) =>
  canRead(caller, round, account, authority, 'round.observe.undelayed', youth);

/**
 * A read a Youth Round's linked adult passes only with that Round's linked
 * adults (ADR 0155). It runs without them first, since nobody else needs
 * them; only a refusal reads them, through the cache, and runs once more when
 * they name this caller. Every other refusal stands as it was.
 */
export const withLinkedAdults = async <T>(
  caller: { readonly actorId: string },
  roundId: string,
  linkedAdults: LinkedAdultsOf,
  read: (youth: YouthLiveFact | null) => Promise<T>,
): Promise<T> => {
  try {
    return await read(null);
  } catch (error) {
    if (!isAppError(error) || error.code !== 'NOT_FOUND') throw error;
    const youth = await linkedAdults(roundId);
    if (!youth?.linkedAdultActorIds.includes(caller.actorId)) throw error;
    return read(youth);
  }
};

/** The Round as this caller may see it: every read of it, one composition. */
export const roundViewReader =
  (
    store: Pick<Database, 'readLaunchedRound'> & {
      readonly broadcasts: Pick<Database['broadcasts'], 'conversationHeld'>;
    },
    linkedAdults: LinkedAdultsOf,
  ) =>
  async (
    caller: { readonly userId: string; readonly actorId: string },
    roundId: string,
  ) => {
    let viewerIsUndelayedObserver = false;
    const view = await withLinkedAdults(
      caller,
      roundId,
      linkedAdults,
      (youth) =>
        store.readLaunchedRound(
          roundId,
          caller,
          (round, account, authority) => {
            viewerIsUndelayedObserver = canObserveUndelayed(
              caller,
              round,
              account,
              authority,
              youth,
            );
            // A linked adult reads the Round only as its watcher (ADR 0155).
            return (
              canReadRound(caller, round, account, authority) ||
              (youth !== null && viewerIsUndelayedObserver)
            );
          },
          readRoundOpening,
          roundWaitingOn,
          (owner) =>
            eventBallotAccess(caller, owner).parts.includes('decision'),
        ),
    );
    return {
      ...view,
      viewerIsUndelayedObserver,
      conversationHeld: await store.broadcasts.conversationHeld(roundId),
    };
  };
