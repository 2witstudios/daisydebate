import {
  authorize,
  type AccountAuthorizationFact,
} from '@daisy/auth/authorization';
import type { LaunchedRound } from '@daisy/protocol';
const canRead = (
  caller: { readonly userId: string; readonly actorId: string },
  round: LaunchedRound,
  account: AccountAuthorizationFact | null,
  capability: 'round.read' | 'round.transcript.read',
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
