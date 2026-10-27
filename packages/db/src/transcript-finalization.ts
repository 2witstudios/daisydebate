import { appendTranscriptChanged } from './transcript-signal';
import { createAppError } from '@daisy/errors';
import { eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { BoundedTransactionContext } from './transaction-context';
import {
  executeLockedRoundTick,
  type LockedRoundTickInput,
} from './round-clock-transaction';
import { sampleRoundExecutionTime } from './round-execution-time';
import {
  readLockedFrozenRoundTranscript,
  readTranscriptFreeze,
} from './frozen-transcript';
import {
  closeUnresolvedStreams,
  lockFinalizationStreams,
} from './transcript-finalization-streams';
import { finalizationState } from './transcript-finalization-state';
import { roundTranscriptFreezes } from './schema/round-transcript-freezes';
import { roundTranscripts } from './schema/transcript-segments';
import { rounds } from './schema/rounds';

export const transcriptFinalizationOperations = (input: {
  readonly database: BunSQLDatabase;
}) => ({
  /** Callers enforce private transcript/judge authorization before this internal read. */
  readFrozenRoundTranscript: (roundId: string) =>
    readLockedFrozenRoundTranscript(input.database, roundId),
});

export type FreezeRequest = LockedRoundTickInput & {
  /**
   * The caller's judging rule for this freeze (DEC-201, DEC-207, DEC-208): how
   * long judges may rule after it, and whether AI judges are dispatched.
   */
  readonly planJudging: (facts: {
    readonly completeness: 'complete' | 'incomplete';
    readonly humanJudges: boolean;
  }) => {
    readonly ballotDeadlineMs: number;
    readonly dispatchAiJudges: boolean;
  };
};
/**
 * Persists the ballot deadline once from the freeze time and queues one AI
 * judging intent per eligible bot judge, unless the plan withholds AI judging.
 */
async function planFrozenJudging(
  tx: BoundedTransactionContext,
  request: FreezeRequest,
  completeness: 'complete' | 'incomplete',
) {
  const [judges] =
    (await tx.execute(sql`select exists(select 1 from round_participants p join actors a on a.id=p.actor_id
    where p.round_id=${request.roundId} and p.role='judge' and a.kind='human') as "humanJudges"`)) as unknown as {
      humanJudges: boolean;
    }[];
  const plan = request.planJudging({
    completeness,
    humanJudges: judges!.humanJudges,
  });
  if (!Number.isSafeInteger(plan.ballotDeadlineMs) || plan.ballotDeadlineMs < 0)
    throw createAppError('VALIDATION');
  await tx.execute(
    sql`update rounds set ballot_deadline_at=(select frozen_at from round_transcript_freezes where round_id=${request.roundId})+${plan.ballotDeadlineMs}*interval '1 millisecond' where id=${request.roundId}`,
  );
  if (!plan.dispatchAiJudges) return;
  // Canonical bot eligibility requires its profile, as in actorFact; kind alone is insufficient.
  await tx.execute(sql`insert into round_judging_jobs (round_id,freeze_revision,judge_participant_id,status,attempts)
    select ${request.roundId},1,p.id,'queued',0 from round_participants p join actors a on a.id=p.actor_id join bot_profiles b on b.actor_id=a.id
    where p.round_id=${request.roundId} and p.role='judge' and a.kind='bot'
    on conflict (round_id,judge_participant_id) do nothing`);
}
/** Existing Round/lease/stream operation; a service consumer can recheck its lease after waits. */
export async function finalizeLockedRoundTranscript(
  tx: BoundedTransactionContext,
  request: FreezeRequest,
  assertCurrent: () => Promise<void> = async () => {},
) {
  const clock = await executeLockedRoundTick(tx, request);
  await assertCurrent();
  const existing = await readTranscriptFreeze(tx, request.roundId);
  if (existing) return { status: 'frozen' as const, freeze: existing };
  const [round] = await tx
    .select({ status: rounds.status })
    .from(rounds)
    .where(eq(rounds.id, request.roundId));
  if (round?.status !== 'active') return { status: 'terminal' as const };
  if (
    clock.finalSegmentEndedAt === null ||
    clock.transcriptAdmissionCutoff === null
  )
    return { status: 'pending' as const, reason: 'final-segment' as const };
  const facts = await lockFinalizationStreams(tx, request.roundId);
  const now = await sampleRoundExecutionTime(tx);
  await assertCurrent();
  const state = finalizationState(facts, now, clock.transcriptAdmissionCutoff);
  if (state === 'capture')
    return { status: 'pending' as const, reason: 'capture' as const };
  // No network/provider work: serialize all committed text before closing its frontier.
  await closeUnresolvedStreams(tx, request.roundId, facts);
  const [frontier] = await tx
    .select()
    .from(roundTranscripts)
    .where(eq(roundTranscripts.roundId, request.roundId));
  const revision = frontier?.revision ?? 0;
  const [freeze] = await tx
    .insert(roundTranscriptFreezes)
    .values({
      roundId: request.roundId,
      revision: 1,
      frontier: revision,
      completeness: state,
    })
    .returning();
  await planFrozenJudging(tx, request, state);
  await appendTranscriptChanged(tx, request.roundId, revision + 1);
  return {
    status: 'frozen' as const,
    freeze: { ...freeze!, frozenAt: freeze!.frozenAt.toISOString() },
  };
}
