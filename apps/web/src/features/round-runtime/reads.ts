import {
  authorize,
  type AccountAuthorizationFact,
} from '@daisy/auth/authorization';
import type { Database } from '@daisy/db';
import { readRoundOpening, roundWaitingOn } from '@daisy/debate-engine';
import type { LaunchedRound } from '@daisy/protocol';
const canRead = (
  caller: { readonly userId: string; readonly actorId: string },
  round: LaunchedRound,
  account: AccountAuthorizationFact | null,
  capability:
    'round.read' | 'round.transcript.read' | 'round.observe.undelayed',
) =>
  authorize({
    principal: { kind: 'user', ...caller },
    capability,
    context: { account },
    resource: {
      kind: 'round',
      roundId: round.id,
      createdByActorId: round.hostActorId,
      visibility: round.visibility,
      status: round.status,
      participants: round.participants,
      revision: round.version,
    },
  }).allow;

/** One current transcript audience policy for live and completed reads. */
export const canReadTranscript = (
  caller: { readonly userId: string; readonly actorId: string },
  round: LaunchedRound,
  account: AccountAuthorizationFact | null,
) => canRead(caller, round, account, 'round.transcript.read');

export const canReadRound = (
  caller: { readonly userId: string; readonly actorId: string },
  round: LaunchedRound,
  account: AccountAuthorizationFact | null,
) => canRead(caller, round, account, 'round.read');

/** A seatless host's live room (WATCH-6); a seated host reads through the seat. */
export const canObserveUndelayed = (
  caller: { readonly userId: string; readonly actorId: string },
  round: LaunchedRound,
  account: AccountAuthorizationFact | null,
) => canRead(caller, round, account, 'round.observe.undelayed');

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
      (round, account) => {
        viewerIsUndelayedObserver = canObserveUndelayed(caller, round, account);
        return canReadRound(caller, round, account);
      },
      readRoundOpening,
      roundWaitingOn,
    );
    return {
      ...view,
      viewerIsUndelayedObserver,
      conversationHeld: await store.broadcasts.conversationHeld(roundId),
    };
  };
