import type { RoomStore } from '@daisy/db/stores/rooms';
import type { BroadcastStore } from '@daisy/db/stores/broadcasts';
import type { RoundRoomAuthority } from '@daisy/db/stores/rounds';
import { eventBallotAccess } from '../round-ballots/audience';
import {
  authorize,
  type AccountAuthorizationFact,
} from '@daisy/auth/authorization';
import type { YouthLiveFact } from '@daisy/auth/live-audience';
import {
  withLinkedAdults,
  type LinkedAdultsOf,
} from '../spectating/linked-adults';
import { eventRoomOwner } from '../tab/event-room-direction';
import { readRoundOpening, roundWaitingOn } from '@daisy/debate-engine';
import type { LaunchedRound } from '@daisy/protocol/round-view';
const canRead = (
  caller: { readonly userId: string; readonly actorId: string },
  round: LaunchedRound,
  account: AccountAuthorizationFact | null,
  authority: RoundRoomAuthority,
  capability:
    'round.read' | 'round.transcript.read' | 'round.observe.undelayed',
  youth: YouthLiveFact | null,
) => {
  if (authority.kind === 'unavailable') return false;
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
const canObserveUndelayed = (
  caller: { readonly userId: string; readonly actorId: string },
  round: LaunchedRound,
  account: AccountAuthorizationFact | null,
  authority: RoundRoomAuthority,
  youth: YouthLiveFact | null = null,
) =>
  canRead(caller, round, account, authority, 'round.observe.undelayed', youth);

/** The Round as this caller may see it: every read of it, one composition. */
export const roundViewReader =
  (
    store: Pick<RoomStore, 'readLaunchedRound'> & {
      readonly broadcasts: Pick<
        BroadcastStore['broadcasts'],
        'conversationHeld'
      >;
    },
    linkedAdults: LinkedAdultsOf,
  ) =>
  async (
    caller: { readonly userId: string; readonly actorId: string },
    roundId: string,
  ) => {
    // The read's authority callback records how this viewer watches.
    const watcher: { as: 'host' | 'linked_adult' | null } = { as: null };
    const view = await withLinkedAdults(
      caller,
      roundId,
      linkedAdults,
      (youth, refused) =>
        store.readLaunchedRound(
          roundId,
          caller,
          (round, account, authority) => {
            // A capability held without the links (a seatless host, an
            // event's official) is a host's; one that needs them, a linked
            // adult's (ADR 0155).
            watcher.as = canObserveUndelayed(
              caller,
              round,
              account,
              authority,
              null,
            )
              ? 'host'
              : youth !== null &&
                  canObserveUndelayed(caller, round, account, authority, youth)
                ? 'linked_adult'
                : null;
            // A linked adult reads the Round only as its watcher (ADR 0155).
            const allowed =
              canReadRound(caller, round, account, authority) ||
              watcher.as === 'linked_adult';
            if (!allowed) refused();
            return allowed;
          },
          readRoundOpening,
          roundWaitingOn,
          (owner) =>
            eventBallotAccess(caller, owner).parts.includes('decision'),
        ),
    );
    return {
      ...view,
      ...(watcher.as ? { viewerWatchesAs: watcher.as } : {}),
      conversationHeld: await store.broadcasts.conversationHeld(roundId),
    };
  };
