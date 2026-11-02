import {
  decidePanelCompletion,
  onTimeSpeakerReceipt,
} from '@daisy/debate-engine';
import { attendanceTimingPolicy, type RoundRules } from '@daisy/protocol';
import type { SQL } from 'bun';
import { attendanceReceiptTime } from '../src/features/attendance/receipt-time';
import { attendanceWindowFor } from '../src/features/attendance/windows';
import { AI_JUDGING_BUDGET_MS } from '../src/features/round-finalization/maintenance';

type Seat = {
  readonly id: string;
  readonly role: string;
  readonly slot: number;
  readonly kind: string;
};
/**
 * One-off for ISSUE-906's sign-off: delete with that task. Metadata only:
 * nothing here can hold a transcript, ballot text or a name.
 */
export type DryRunFacts = {
  readonly roundId: string;
  readonly nowMs: number;
  readonly status: string;
  readonly ladderId: string | null;
  readonly finalEndedAt: string | null;
  readonly completeness: 'complete' | 'incomplete' | null;
  readonly frozenAt: string | null;
  readonly ballotDeadlineAt: string | null;
  readonly pendingWriters: number;
  readonly rules: Pick<RoundRules, 'segments'>;
  readonly seats: readonly Seat[];
  readonly segments: readonly {
    readonly id: string;
    readonly key: string;
    readonly type: string;
    readonly startedAt: string;
  }[];
  readonly receipts: readonly {
    readonly segmentId: string;
    readonly participantId: string;
    readonly receivedAt: string;
  }[];
  readonly decidedSegmentIds: readonly string[];
  readonly ballots: readonly {
    readonly judgeParticipantId: string;
    readonly winner: 'affirmative' | 'negative';
    readonly status: 'submitted' | 'voided';
  }[];
  readonly jobs: readonly {
    readonly judgeParticipantId: string;
    readonly status: string;
    readonly holdsBallot: boolean;
    /** Null before the ADR 0095 migrations: then the budget from the freeze applies. */
    readonly generationDeadlineAt: string | null;
    /** Calls that may already have been served. */
    readonly paidCalls: number;
  }[];
};

/** The calls one job may buy; the job itself enforces this. */
const MAX_CALLS = 2;

/** Each non-final speech through the real window and on-time decisions. */
function windowsOf(facts: DryRunFacts) {
  const speeches = facts.rules.segments.filter((s) => s.type === 'speech');
  const lastKey = speeches.at(-1)?.key;
  const round = {
    rules: facts.rules,
    participants: facts.seats,
    segments: facts.segments.map((segment) => ({
      id: segment.id,
      type: segment.type,
      rulesSegmentKey: segment.key,
      startedAt: segment.startedAt,
    })),
  } as unknown as Parameters<typeof attendanceWindowFor>[0];
  const debaters = facts.seats
    .filter((seat) => seat.role !== 'judge')
    .map((seat) => seat.id);
  return facts.segments
    .filter((s) => s.type === 'speech' && s.key !== lastKey)
    .map((segment) => ({
      key: segment.key,
      alreadyDecided: facts.decidedSegmentIds.includes(segment.id),
      onTimeSpeakerReceipt:
        onTimeSpeakerReceipt({
          window: attendanceWindowFor(round, segment.id, debaters),
          checkIns: facts.receipts
            .filter((receipt) => receipt.segmentId === segment.id)
            .map((receipt) => ({
              participantId: receipt.participantId,
              receivedAtMs: attendanceReceiptTime(receipt.receivedAt),
            })),
        }) !== null,
    }));
}

/**
 * What the deployed completion rules would do to this Round on their next
 * passes (ADR 0095), from its recorded facts alone. It treats every speaker as
 * eligible when reading receipts, and says so in its report. Prediction, not
 * authority.
 */
export function predictRoundCompletion(facts: DryRunFacts) {
  const windows = windowsOf(facts);
  const unproven = windows.filter(
    (w) => !w.alreadyDecided && !w.onTimeSpeakerReceipt,
  );
  const report = {
    roundId: facts.roundId,
    current: {
      status: facts.status,
      completeness: facts.completeness,
      ranked: facts.ladderId !== null,
      pendingWriters: facts.pendingWriters,
    },
    windows,
    assumes: 'every scheduled speaker is still eligible to attend',
  };
  const done = (prediction: Record<string, unknown>) => ({
    ...report,
    prediction: { mostNewPaidCalls: 0, ...prediction },
  });
  if (facts.status !== 'active')
    return done({ result: 'unchanged', reason: 'already_terminal' });
  if (facts.pendingWriters > 0)
    return done({ result: 'unchanged', reason: 'held_by_pending_writer' });
  if (!facts.finalEndedAt)
    return done({ result: 'unchanged', reason: 'speeches_not_ended' });
  if (unproven.length > 0) {
    const cutoffMs =
      Date.parse(facts.finalEndedAt) +
      attendanceTimingPolicy.resolutionCutoffMs;
    return done({
      result: 'needs_settled_availability',
      unproven: unproven.map((w) => w.key),
      withoutItAbandonsNoWinnerAt: new Date(cutoffMs).toISOString(),
      abandonsOnNextPass: facts.nowMs >= cutoffMs,
    });
  }
  if (!facts.completeness)
    return done({ result: 'unchanged', reason: 'transcript_not_frozen' });
  const endsAtCutoffMs =
    Date.parse(facts.finalEndedAt) + attendanceTimingPolicy.resolutionCutoffMs;
  const running = facts.jobs.filter((job) => {
    if (!['queued', 'leased'].includes(job.status)) return false;
    const budgetEndsMs = job.generationDeadlineAt
      ? Date.parse(job.generationDeadlineAt)
      : Date.parse(facts.frozenAt ?? '') + AI_JUDGING_BUDGET_MS;
    return (
      facts.nowMs < budgetEndsMs ||
      (job.holdsBallot && facts.nowMs < endsAtCutoffMs)
    );
  });
  const decision = decidePanelCompletion({
    completeness: facts.completeness,
    humanJudgeSeatIds: facts.seats
      .filter((seat) => seat.role === 'judge' && seat.kind === 'human')
      .map((seat) => seat.id),
    judgeSeatIds: facts.seats
      .filter((seat) => seat.role === 'judge')
      .map((seat) => seat.id),
    runningAiSeatIds: running.map((job) => job.judgeParticipantId),
    failedAiSeatIds: facts.jobs
      .filter(
        (job) =>
          job.status !== 'succeeded' &&
          !running.some((r) => r.judgeParticipantId === job.judgeParticipantId),
      )
      .map((job) => job.judgeParticipantId),
    ballots: facts.ballots,
    ballotDeadlineAtMs: facts.ballotDeadlineAt
      ? Date.parse(facts.ballotDeadlineAt)
      : Number.NaN,
    nowMs: facts.nowMs,
  });
  return done({
    mostNewPaidCalls: running
      .filter((job) => !job.holdsBallot)
      .reduce(
        (calls, job) => calls + Math.max(0, MAX_CALLS - job.paidCalls),
        0,
      ),
    ...(decision.kind === 'pending'
      ? { result: 'waiting_on_a_judge' }
      : {
          result: 'completed',
          ruling: decision.ruling,
          outcome: decision.outcome,
          ratingWritten:
            facts.ladderId !== null &&
            decision.outcome !== null &&
            facts.completeness === 'complete',
        }),
  });
}

/**
 * Reads one Round inside a READ ONLY transaction, so PostgreSQL itself refuses
 * any write. Selects named metadata columns only, and works before or after the
 * ADR 0095 migrations.
 */
export async function readDryRunFacts(
  sql: SQL,
  roundId: string,
): Promise<DryRunFacts | null> {
  return sql.begin('read only', async (tx) => {
    const [mode] = await tx`show transaction_read_only`;
    if (mode.transaction_read_only !== 'on')
      throw new Error('The dry run requires a read-only transaction');
    const [round] = await tx`select r.status,r.ladder_id,r.rules_snapshot,
      r.final_segment_ended_at,r.ballot_deadline_at,z.completeness,z.frozen_at,
      clock_timestamp() as now,
      (select count(*)::int from round_check_in_attempts a where a.round_id=r.id and a.state='pending') as pending
      from rounds r left join round_transcript_freezes z on z.round_id=r.id
      where r.id=${roundId}`;
    if (!round) return null;
    const iso = (value: Date | null) => value?.toISOString() ?? null;
    const segments =
      await tx`select id,rules_segment_key as key,type,started_at from round_segments where round_id=${roundId} order by sequence`;
    const seats =
      await tx`select p.id,p.role,p.slot,a.kind from round_participants p join actors a on a.id=p.actor_id where p.round_id=${roundId}`;
    const receipts =
      await tx`select segment_id,participant_id,to_char(received_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as received_at from round_check_ins where round_id=${roundId}`;
    const decided =
      await tx`select segment_id from round_attendance_adjudications where round_id=${roundId}`;
    const ballots =
      await tx`select judge_participant_id,winner,status from ballots where round_id=${roundId}`;
    const jobs =
      await tx`select judge_participant_id,status,pending_ballot is not null as holds,to_jsonb(j)->>'generation_deadline_at' as deadline,(select count(*)::int from agent_runs u where u.round_participant_id=j.judge_participant_id and u.kind='judging' and u.configuration_snapshot->>'providerOutcome' in ('unknown','received')) as paid from round_judging_jobs j where round_id=${roundId}`;
    return {
      roundId,
      nowMs: (round.now as Date).getTime(),
      status: round.status,
      ladderId: round.ladder_id,
      finalEndedAt: iso(round.final_segment_ended_at),
      completeness: round.completeness,
      frozenAt: iso(round.frozen_at),
      ballotDeadlineAt: iso(round.ballot_deadline_at),
      pendingWriters: round.pending,
      rules: round.rules_snapshot,
      seats,
      segments: segments.map(
        (s: { id: string; key: string; type: string; started_at: Date }) => ({
          id: s.id,
          key: s.key,
          type: s.type,
          startedAt: s.started_at.toISOString(),
        }),
      ),
      receipts: receipts.map(
        (r: {
          segment_id: string;
          participant_id: string;
          received_at: string;
        }) => ({
          segmentId: r.segment_id,
          participantId: r.participant_id,
          receivedAt: r.received_at,
        }),
      ),
      decidedSegmentIds: decided.map(
        (d: { segment_id: string }) => d.segment_id,
      ),
      ballots: ballots.map(
        (b: {
          judge_participant_id: string;
          winner: 'affirmative' | 'negative';
          status: 'submitted' | 'voided';
        }) => ({
          judgeParticipantId: b.judge_participant_id,
          winner: b.winner,
          status: b.status,
        }),
      ),
      jobs: jobs.map(
        (j: {
          judge_participant_id: string;
          status: string;
          holds: boolean;
          deadline: string | null;
          paid: number;
        }) => ({
          judgeParticipantId: j.judge_participant_id,
          status: j.status,
          holdsBallot: j.holds,
          generationDeadlineAt: j.deadline,
          paidCalls: j.paid,
        }),
      ),
    };
  }) as Promise<DryRunFacts | null>;
}
