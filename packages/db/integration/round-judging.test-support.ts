import { judgingJobRules } from '@daisy/debate-engine';
import { ballotCategories, ballotSchema } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { createBotSeat } from './bot-seat.test-support';
import { withBoundedRound } from './bounded-transaction.test-support';
import { createRoundJudgingJobs } from '../src/round-judging-jobs';
import type { Fixture } from './constraint-helpers';
import { admissionSponsor, betaAllowance } from './bot-admission.test-support';
import { createCasualJudgeAdmission } from '../src/casual-judge-admission';
import type { BoundedTransaction } from '../src/bounded-transaction';
import { canUseAiAllowance } from '@daisy/auth/authorization';

/** A validated rubric response, as cached on a pending judging job. */
export const syntheticPendingBallot = ballotSchema.parse({
  rubricVersion: 'speaker-10@1',
  winner: 'affirmative',
  scores: Object.fromEntries(
    ['affirmative', 'negative'].map((side) => [
      side,
      Object.fromEntries(ballotCategories.map((category) => [category, 3])),
    ]),
  ),
  reason: 'Synthetic recovery fixture',
  feedback: {},
});

export async function judgingSponsor(
  fixture: Fixture,
  roundId: string,
  run: BoundedTransaction,
) {
  const actorId = await admissionSponsor(fixture, [roundId]);
  const policy = betaAllowance();
  const admission = createCasualJudgeAdmission({
    nextId: createId,
    policy: {
      decide: policy.allowance,
      accountEligible: policy.accountEligible,
    },
  });
  await run((tx) => admission.reserveLocked(tx, { actorId, roundId }));
  return actorId;
}

/** An admitted casual judge on an active Round, with frozen evidence and its durable job. */
export const withJudgingJob = (
  work: (value: {
    fixture: Fixture;
    roundId: string;
    target: { roundId: string; judgeParticipantId: string };
    jobs: ReturnType<typeof createRoundJudgingJobs>;
  }) => Promise<void>,
  completeness: 'complete' | 'incomplete' = 'complete',
  beforeFreeze?: (
    fixture: Fixture,
    target: { roundId: string; judgeParticipantId: string },
  ) => Promise<void>,
) =>
  withBoundedRound(async (fixture, run, roundId) => {
    const seat = await createBotSeat(fixture, roundId, 'judge');
    await judgingSponsor(fixture, roundId, run);
    const target = { roundId, judgeParticipantId: seat.id };
    await fixture.sql`update rounds set status='active',current_stage='live',started_at=clock_timestamp(),final_segment_ended_at=date_trunc('milliseconds',statement_timestamp())-interval '1 minute',transcript_admission_cutoff=date_trunc('milliseconds',statement_timestamp())-interval '1 minute'+interval '120 seconds',attendance_resolution_cutoff_at=date_trunc('milliseconds',statement_timestamp())-interval '1 minute'+interval '60 minutes' where id=${roundId}`;
    await beforeFreeze?.(fixture, target);
    await fixture.sql`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${roundId},1,0,${completeness})`;
    await fixture.sql`insert into round_judging_jobs(round_id,judge_participant_id,freeze_revision,status,generation_deadline_at) values(${roundId},${seat.id},1,'queued',clock_timestamp()+interval '5 minutes')`;
    try {
      await work({
        fixture,
        roundId,
        target,
        jobs: createRoundJudgingJobs({
          run,
          nextId: createId,
          nextToken: () => randomBytes(32).toString('base64url'),
          leaseMs: 30000,
          model: 'anthropic/claude-sonnet-5.5',
          contractVersion: 'fixture-contract',
          rules: judgingJobRules,
          accountEligible: canUseAiAllowance,
        }),
      });
    } finally {
      await fixture.sql`delete from rounds where id=${roundId}`;
    }
  });
