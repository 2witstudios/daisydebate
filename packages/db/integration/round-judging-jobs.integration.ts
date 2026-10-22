import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createBotSeat } from './bot-seat.test-support';
import { withBoundedRound } from './bounded-transaction.test-support';
import { createRoundJudgingJobs } from '../src/round-judging-jobs';
setupRitewayBun();
requireTestServices(process.env);

test('durable judging claims fence epochs and preserve one command across recovery', async () => {
  await withBoundedRound(async (fixture, run, roundId) => {
    const seat = await createBotSeat(fixture, roundId, 'judge');
    await fixture.sql`update rounds set status='active',current_stage='live',started_at=clock_timestamp() where id=${roundId}`;
    await fixture.sql`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${roundId},1,0,'incomplete')`;
    await fixture.sql`insert into round_judging_jobs(round_id,judge_participant_id,freeze_revision,status) values(${roundId},${seat.id},1,'queued')`;
    try {
      const jobs = createRoundJudgingJobs({
        run,
        nextId: createId,
        nextToken: () => randomBytes(32).toString('base64url'),
        leaseMs: 30000,
        model: 'anthropic/claude-sonnet-5.5',
      });
      const target = { roundId, judgeParticipantId: seat.id };
      const attempts = await Promise.allSettled([
        jobs.claim(target),
        jobs.claim(target),
      ]);
      assert({
        given: 'two workers claiming one actual durable judge intent',
        should: 'admit only one current execution',
        actual: attempts.map((a) => a.status).sort(),
        expected: ['fulfilled', 'rejected'],
      });
      const winner = attempts.find((a) => a.status === 'fulfilled');
      if (winner?.status !== 'fulfilled')
        throw new Error('Expected judge claim');
      const first = winner.value;
      await jobs.beginModelCall(first.scope, first.token);
      await assertRejects({
        given: 'a duplicate dispatch in the same attempt',
        should: 'refuse a second provider call',
        actual: () => jobs.beginModelCall(first.scope, first.token),
        code: 'CONFLICT',
      });
      await fixture.sql`update round_judging_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
      const second = await jobs.claim(target);
      await assertRejects({
        given: 'an old worker after lease takeover',
        should: 'refuse result authority',
        actual: () => jobs.verify(first.scope, first.token),
        code: 'CONFLICT',
      });
      const [oldRun] =
        await fixture.sql`select ended_at,configuration_snapshot from agent_runs where id=${first.scope.agentRunId}`;
      assert({
        given: 'recovered durable uncertain dispatch',
        should:
          'advance epoch with new run while retaining command and uncertainty',
        actual: [
          second.scope.jobEpoch,
          second.scope.commandId === first.scope.commandId,
          second.scope.agentRunId !== first.scope.agentRunId,
          oldRun!.ended_at !== null,
          oldRun!.configuration_snapshot.providerOutcome,
          JSON.stringify(oldRun!.configuration_snapshot).includes(first.token),
          second.frozen.revision,
          await fixture.count('ballots', 'round_id', roundId),
        ],
        expected: [2, true, true, true, 'unknown', false, 1, 0],
      });
    } finally {
      await fixture.sql`delete from rounds where id=${roundId}`;
    }
  });
});
