import { loadAuthorizationSessions } from '@daisy/db/authorization';
import type { RealtimeAuthorityReads } from '@daisy/db';
import { isAppError } from '@daisy/errors';
import type { SocketPrincipal } from '../registry';
import type { PermitDecision } from './permits';
import { decideRoomCommunityPermit } from './room-community-viewer';
import { decideRoundFloorPermit } from './round-floor-viewer';
import { linkedAdultsFor } from '@daisy/db/youth-live';
import type { YouthLiveFact } from '@daisy/protocol/youth-live';

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
 * A floor's permits. A viewer the Round names nowhere is asked again with the
 * Round's linked adults (ADR 0155), read only then, since nobody else needs
 * them: a Youth Round's linked coach or parent reads its floor.
 */
async function roundFloorPermits(
  evaluation: Evaluation,
): Promise<readonly PermitDecision[] | null> {
  const { reads, principals } = evaluation;
  // The Round comes from the cohort's own facts, so no second read finds it.
  // Set by the cohort's decisions, which run inside the read.
  const cohort: { roundId: string | null } = { roundId: null };
  const plain = await evaluateCohort(
    evaluation,
    reads.roundFloorChannelCohortAuthority,
    (viewer: Parameters<typeof decideRoundFloorPermit>[0]) => {
      cohort.roundId = viewer.fact.roundId;
      return decideRoundFloorPermit(viewer);
    },
  );
  if (plain === null || plain.every((permit) => permit.status !== 'denied'))
    return plain;
  // A failed lookup keeps the first pass: the denied stay denied, and those
  // already allowed keep their permits.
  let youth: YouthLiveFact | null = null;
  try {
    youth =
      cohort.roundId === null
        ? null
        : await linkedAdultsFor(reads)(cohort.roundId);
  } catch {
    return plain;
  }
  const asked = principals.filter(
    (principal, index) =>
      plain[index]?.status === 'denied' &&
      youth?.linkedAdultActorIds.includes(principal.actorId) === true,
  );
  if (asked.length === 0) return plain;
  // The re-ask failing keeps the first pass too: one watcher never costs the
  // debaters their permits.
  const again = await evaluateCohort(
    { ...evaluation, principals: asked },
    (input, work) =>
      reads.roundFloorChannelCohortAuthority({ ...input, youth }, work),
    decideRoundFloorPermit,
  ).catch(() => null);
  if (again === null) return plain;
  return principals.map((principal, index) => {
    const at = asked.indexOf(principal);
    return at === -1
      ? (plain[index] ?? { status: 'denied' })
      : (again[at] ?? { status: 'denied' });
  });
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
    (await roundFloorPermits(evaluation)) ??
    (await evaluateCohort(
      evaluation,
      reads.roomCommunityChannelCohortAuthority,
      decideRoomCommunityPermit,
    )) ??
    principals.map(() => ({ status: 'denied' as const }))
  );
}
