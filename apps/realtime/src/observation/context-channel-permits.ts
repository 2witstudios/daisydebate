import { loadAuthorizationSessions } from '@daisy/db/authorization';
import type { RealtimeAuthorityReads } from '@daisy/db';
import { isAppError } from '@daisy/errors';
import type { SocketPrincipal } from '../registry';
import type { PermitDecision } from './permits';
import { decideRoomCommunityPermit } from './room-community-viewer';
import { decideRoundFloorPermit } from './round-floor-viewer';

type Evaluation = {
  readonly reads: RealtimeAuthorityReads;
  readonly id: string;
  readonly principals: readonly SocketPrincipal[];
  readonly clock: { readonly now: () => string };
  readonly now: () => number;
};
/**
 * One context's cohort under its own fences, each viewer bound to a current
 * fenced session. Null when the channel is not this context's to answer for.
 */
async function evaluateCohort<Fact>(
  { id, principals, clock, now }: Evaluation,
  cohort: (
    input: {
      readonly channelId: string;
      readonly viewers: readonly SocketPrincipal[];
    },
    work: (frame: {
      readonly tx: Parameters<typeof loadAuthorizationSessions>[0];
      readonly accounts: Parameters<
        typeof loadAuthorizationSessions
      >[1]['accounts'];
      readonly factFor: (actorId: string) => Fact;
      readonly contentRevision: number;
    }) => Promise<readonly PermitDecision[]>,
  ) => Promise<readonly PermitDecision[]>,
  decide: (viewer: {
    readonly principal: SocketPrincipal;
    readonly session:
      Awaited<ReturnType<typeof loadAuthorizationSessions>>[number] | null;
    readonly fact: Fact;
    readonly contentRevision: number;
    readonly started: number;
    readonly now: number;
    readonly instant: string;
  }) => PermitDecision,
): Promise<readonly PermitDecision[] | null> {
  const started = now();
  try {
    return await cohort(
      { channelId: id, viewers: principals },
      async ({ tx, accounts, factFor, contentRevision }) => {
        const instant = clock.now();
        const sessions = await loadAuthorizationSessions(tx, {
          now: instant,
          sessions: principals,
          accounts,
        });
        return principals.map((principal, index) =>
          decide({
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
    if (isAppError(error) && error.code === 'NOT_FOUND') return null;
    throw error;
  }
}

/**
 * Permits for a channel no social authority answers for: each contextual
 * owner is asked in turn with the same private decision its HTTP routes use,
 * and a channel none of them owns, or whose owner no longer lets it be
 * observed, denies every viewer.
 */
export async function evaluateContextChannelPermits(
  evaluation: Evaluation,
): Promise<readonly PermitDecision[]> {
  const { reads, principals } = evaluation;
  return (
    (await evaluateCohort(
      evaluation,
      reads.roundFloorChannelCohortAuthority,
      decideRoundFloorPermit,
    )) ??
    (await evaluateCohort(
      evaluation,
      reads.roomCommunityChannelCohortAuthority,
      decideRoomCommunityPermit,
    )) ??
    principals.map(() => ({ status: 'denied' as const }))
  );
}
