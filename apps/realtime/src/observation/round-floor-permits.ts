import { decideRoundFloorPermit } from './round-floor-viewer';
import { loadAuthorizationSessions } from '@daisy/db/authorization';
import type { RealtimeAuthorityReads } from '@daisy/db';
import { isAppError } from '@daisy/errors';
import type { SocketPrincipal } from '../registry';
import type { PermitDecision } from './permits';

/** The same private floor decision as HTTP, bound to current fenced sessions. */
export async function evaluateRoundFloorPermits({
  reads,
  id,
  principals,
  clock,
  now,
}: {
  readonly reads: RealtimeAuthorityReads;
  readonly id: string;
  readonly principals: readonly SocketPrincipal[];
  readonly clock: { readonly now: () => string };
  readonly now: () => number;
}): Promise<readonly PermitDecision[]> {
  const started = now();
  try {
    return await reads.roundFloorChannelCohortAuthority(
      { channelId: id, viewers: principals },
      async ({ tx, accounts, factFor, contentRevision }) => {
        const instant = clock.now();
        const sessions = await loadAuthorizationSessions(tx, {
          now: instant,
          sessions: principals,
          accounts,
        });
        return principals.map((principal, index) =>
          decideRoundFloorPermit({
            principal,
            session: sessions[index] ?? null,
            fact: factFor(principal.actorId),
            contentRevision,
            started,
            now: now(),
            instant: clock.now(),
          }),
        );
      },
    );
  } catch (error) {
    if (isAppError(error) && error.code === 'NOT_FOUND')
      return principals.map(() => ({ status: 'denied' as const }));
    throw error;
  }
}
