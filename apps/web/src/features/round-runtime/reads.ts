import {
  authorize,
  type AccountAuthorizationFact,
} from '@daisy/auth/authorization';
import type { LaunchedRound } from '@daisy/protocol';
export const canReadRound = (
  caller: { readonly userId: string; readonly actorId: string },
  round: LaunchedRound,
  account: AccountAuthorizationFact | null,
) =>
  authorize({
    principal: { kind: 'user', ...caller },
    capability: 'round.read',
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
