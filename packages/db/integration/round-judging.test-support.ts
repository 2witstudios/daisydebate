import { ballotCategories, ballotSchema } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { createBotSeat } from './bot-seat.test-support';
import { withBoundedRound } from './bounded-transaction.test-support';
import { createRoundJudgingJobs } from '../src/round-judging-jobs';
import { createRoundBotAdmission } from '../src/round-bot-admission';
import type { Fixture } from './constraint-helpers';

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

export async function judgingSponsor(fixture: Fixture, roundId: string) {
  const userId = await fixture.user();
  await fixture.sql`update users set email_verified=true where id=${userId}`;
  const actorId = await fixture.actor(userId);
  await fixture.sql`update rounds set created_by_actor_id=${actorId} where id=${roundId}`;
  return actorId;
}

/** An active Round with an AI judge seat, a frozen transcript, a queued judging job and a reserved practice. */
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
    const actorId = await judgingSponsor(fixture, roundId);
    const target = { roundId, judgeParticipantId: seat.id };
    await fixture.sql`update rounds set status='active',current_stage='live',started_at=clock_timestamp() where id=${roundId}`;
    await beforeFreeze?.(fixture, target);
    await fixture.sql`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${roundId},1,0,${completeness})`;
    await fixture.sql`insert into round_judging_jobs(round_id,judge_participant_id,freeze_revision,status) values(${roundId},${seat.id},1,'queued')`;
    try {
      await createRoundBotAdmission({
        run,
        nextId: createId,
        busyCap: 4,
      }).reserve({
        roundId,
        actorId,
      });
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
        }),
      });
    } finally {
      await fixture.sql`delete from rounds where id=${roundId}`;
    }
  });
