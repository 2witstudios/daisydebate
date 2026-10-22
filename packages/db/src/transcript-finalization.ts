import { eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { BoundedTransaction } from './bounded-transaction';
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
  streamKey,
} from './transcript-finalization-streams';
import { roundTranscriptFreezes } from './schema/round-transcript-freezes';
import { roundTranscripts } from './schema/transcript-segments';
import { rounds } from './schema/rounds';

export const transcriptFinalizationOperations = (input: {
  readonly database: BunSQLDatabase;
  readonly transaction: BoundedTransaction;
}) => ({
  /** Callers enforce private transcript/judge authorization before this internal read. */
  readFrozenRoundTranscript: (roundId: string) =>
    readLockedFrozenRoundTranscript(input.database, roundId),
});

/** Existing Round/lease/stream operation; a service consumer can recheck its lease after waits. */
export async function finalizeLockedRoundTranscript(
  tx: BoundedTransactionContext,
  request: LockedRoundTickInput,
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
  const [freeze] = await tx
    .insert(roundTranscriptFreezes)
    .values({
      roundId: request.roundId,
      revision: 1,
      frontier: frontier?.revision ?? 0,
      completeness: state,
    })
    .returning();
  // Canonical bot eligibility requires its profile, as in actorFact; kind alone is insufficient.
  // One durable intent per eligible assigned judge; human-only freezes have none.
  await tx.execute(sql`insert into round_judging_jobs (round_id,freeze_revision,judge_participant_id,status,attempts)
    select ${request.roundId},1,p.id,'queued',0 from round_participants p join actors a on a.id=p.actor_id join bot_profiles b on b.actor_id=a.id
    where p.round_id=${request.roundId} and p.role='judge' and a.kind='bot'
    on conflict (round_id,judge_participant_id) do nothing`);
  return {
    status: 'frozen' as const,
    freeze: { ...freeze!, frozenAt: freeze!.frozenAt.toISOString() },
  };
}

function finalizationState(
  facts: Awaited<ReturnType<typeof lockFinalizationStreams>>,
  now: string,
  cutoff: string,
): 'capture' | 'complete' | 'incomplete' {
  const states = new Map(
    facts.streams.map((stream) => [streamKey(stream), stream.state]),
  );
  const allClosed =
    facts.expected.length > 0 &&
    facts.expected.every((stream) =>
      ['complete', 'partial'].includes(states.get(streamKey(stream)) ?? 'open'),
    );
  if (!allClosed && now < cutoff) return 'capture';
  return facts.expected.length > 0 &&
    facts.expected.every(
      (stream) => states.get(streamKey(stream)) === 'complete',
    ) &&
    facts.streams.every((stream) => stream.state === 'complete')
    ? 'complete'
    : 'incomplete';
}
