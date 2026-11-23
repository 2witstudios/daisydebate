import { actorKinds } from './schema/actors';
import { seatKinds } from '@daisy/protocol/seats';
import { listedWord } from './lifecycle-sql';
import { closeAbandonedBotLines } from './bot-phrases';
import { pending as transcriptionRecoveryPending } from './transcription-recovery/pending';
import { readCaptureShortfall } from './capture-shortfall';
import {
  frozenCaptureColumns,
  type FrozenCapture,
} from '@daisy/protocol/capture-judging-limit';
import { type CaptureRule } from '@daisy/protocol/capture-verdict';
import {
  appendRoundPhaseChanged,
  lockedRoundVersion,
} from './round-projection-writer';
import { appendTranscriptChanged } from './transcript-signal';
import { createAppError } from '@daisy/errors';
import { eq, sql } from 'drizzle-orm';
import {
  executeLockedRoundTick,
  type LockedRoundTickInput,
} from './round-clock-transaction';
import {
  sampleRoundExecutionTime,
  type RoundTimeSource,
} from './round-execution-time';
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
import { notifyWork } from './work-wake';
import type { TxSource, Tx } from './tx';
import { run, query } from './raw-rows';
import { z } from 'zod';

export const transcriptFinalizationOperations = (input: {
  readonly database: TxSource;
}) => ({
  /** Callers enforce private transcript/judge authorization before this internal read. */
  readFrozenRoundTranscript: (roundId: string) =>
    readLockedFrozenRoundTranscript(input.database, roundId),
});

export type FreezeRequest = LockedRoundTickInput & {
  /** The engine's rule, shared with the seal: a bot's unused grant owes no stream. */
  readonly botGrantUnused: CaptureRule['botGrantUnused'];
  /**
   * The caller's judging rule for this freeze (DEC-201, DEC-207, DEC-208): how
   * long judges may rule after it, and whether AI judges are dispatched.
   */
  readonly captureRule: CaptureRule;
  readonly planJudging: (facts: {
    readonly completeness: 'complete' | 'incomplete';
    readonly humanJudges: boolean;
    readonly capture: FrozenCapture;
  }) => {
    /** Null when no human judge sits: no human window exists. */
    readonly ballotDeadlineMs: number | null;
    readonly dispatchAiJudges: boolean;
    /** How long an AI judging job may buy provider work after the freeze (DEC-275). */
    readonly aiJudgingBudgetMs: number;
  };
};
/**
 * Persists the ballot deadline once from the freeze time and queues one AI
 * judging intent per eligible bot judge, unless the plan withholds AI judging.
 */
async function planFrozenJudging(
  tx: Tx,
  request: FreezeRequest,
  completeness: 'complete' | 'incomplete',
  capture: FrozenCapture,
) {
  const [judges] = await query(
    tx,
    z.object({ humanJudges: z.boolean() }),
    sql`select exists(select 1 from round_participants p join actors a on a.id=p.actor_id
    where p.round_id=${request.roundId} and p.seat_kind=${listedWord(seatKinds, 'judge')} and public.daisy_round_participant_is_current(p.id) and a.kind=${listedWord(actorKinds, 'human')}) as "humanJudges"`,
  );
  if (!judges) throw createAppError('INVARIANT');
  const plan = request.planJudging({
    completeness,
    humanJudges: judges.humanJudges,
    capture,
  });
  if (plan.ballotDeadlineMs !== null) {
    if (
      !Number.isSafeInteger(plan.ballotDeadlineMs) ||
      plan.ballotDeadlineMs < 0
    )
      throw createAppError('VALIDATION');
    await run(
      tx,
      sql`update rounds set ballot_deadline_at=(select frozen_at from round_transcript_freezes where round_id=${request.roundId})+${plan.ballotDeadlineMs}*interval '1 millisecond' where id=${request.roundId}`,
    );
  }
  if (!plan.dispatchAiJudges) return;
  if (
    !Number.isSafeInteger(plan.aiJudgingBudgetMs) ||
    plan.aiJudgingBudgetMs < 1
  )
    throw createAppError('VALIDATION');
  // The AI judge is eligible by its own profile (ISSUE-750); kind alone is insufficient.
  await run(
    tx,
    sql`insert into round_judging_jobs (round_id,freeze_revision,judge_participant_id,status,attempts,generation_deadline_at)
    select ${request.roundId},1,p.id,'queued',0,(select frozen_at from round_transcript_freezes where round_id=${request.roundId})+${plan.aiJudgingBudgetMs}*interval '1 millisecond' from round_participants p join actors a on a.id=p.actor_id join ai_judge_profiles j on j.actor_id=a.id
    where p.round_id=${request.roundId} and p.seat_kind=${listedWord(seatKinds, 'judge')} and public.daisy_round_participant_is_current(p.id) and a.kind=${listedWord(actorKinds, 'bot')}
    on conflict (round_id,judge_participant_id) do nothing`,
  );
  await notifyWork(tx, 'judging');
}
/** Existing Round/lease/stream operation; a service consumer can recheck its lease after waits. */
export async function finalizeLockedRoundTranscript(
  tx: Tx,
  request: FreezeRequest,
  assertCurrent: () => Promise<void> = async () => {},
  roundTime?: RoundTimeSource,
) {
  const clock = await executeLockedRoundTick(tx, request, roundTime);
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
  // A bot line its worker never closed keeps only what could have played
  // (ADR 0122), and is closed before the streams it decides are read.
  await closeAbandonedBotLines(tx, request.roundId);
  const facts = await lockFinalizationStreams(
    tx,
    request.roundId,
    request.botGrantUnused,
  );
  const recoveryPending = await transcriptionRecoveryPending(
    tx,
    request.roundId,
  );
  const now = await sampleRoundExecutionTime(tx, roundTime);
  await assertCurrent();
  const state = finalizationState(
    facts,
    now,
    clock.transcriptAdmissionCutoff,
    recoveryPending,
  );
  if (state === 'capture')
    return { status: 'pending' as const, reason: 'capture' as const };
  // No network/provider work: serialize all committed text before closing its frontier.
  await closeUnresolvedStreams(tx, request.roundId, facts);
  const [frontier] = await tx
    .select()
    .from(roundTranscripts)
    .where(eq(roundTranscripts.roundId, request.roundId));
  const revision = frontier?.revision ?? 0;
  const shortfall = await readCaptureShortfall(
    tx,
    request.roundId,
    request.captureRule,
  );
  const [freeze] = await tx
    .insert(roundTranscriptFreezes)
    .values({
      roundId: request.roundId,
      frozenAt: new Date(now),
      revision: 1,
      frontier: revision,
      completeness: state,
      ...frozenCaptureColumns(shortfall.capture),
      captureGaps: shortfall.captureGaps,
    })
    .returning();
  if (!freeze) throw createAppError('INVARIANT');
  await planFrozenJudging(tx, request, state, shortfall.capture);
  await appendTranscriptChanged(tx, request.roundId, revision + 1);
  // What the Round waits on changes here, so the room must read it: a new version
  // and a ring, as with any other change the server records.
  const { version } = await lockedRoundVersion(tx, request.roundId);
  await tx
    .update(rounds)
    .set({ version: version + 1 })
    .where(eq(rounds.id, request.roundId));
  await appendRoundPhaseChanged(tx, request.roundId, version + 1);
  return {
    status: 'frozen' as const,
    freeze: { ...freeze, frozenAt: freeze.frozenAt.toISOString() },
  };
}
