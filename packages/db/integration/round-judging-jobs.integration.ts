import { createId } from '@paralleldrive/cuid2';
import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { ballotCategories, ballotSchema } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
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
      const ballot = ballotSchema.parse({
        rubricVersion: 'speaker-10@1',
        winner: 'affirmative',
        reason: 'Affirmative answered the decisive comparison.',
        feedback: {},
        scores: Object.fromEntries(
          ['affirmative', 'negative'].map((side) => [
            side,
            Object.fromEntries(
              ballotCategories.map((category) => [category, 3]),
            ),
          ]),
        ),
      });
      await jobs.saveResult(first.scope, first.token, ballot);
      await jobs.saveResult(first.scope, first.token, ballot);
      await assertRejects({
        given: 'a different result after a durable response',
        should: 'preserve the first validated response',
        actual: () =>
          jobs.saveResult(first.scope, first.token, {
            ...ballot,
            winner: 'negative',
          }),
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
          second.pendingBallot,
        ],
        expected: [2, true, true, true, 'received', false, 1, 0, ballot],
      });
      await assertRejects({
        given: 'a takeover with a durable response waiting for submission',
        should: 'refuse another provider call',
        actual: () => jobs.beginModelCall(second.scope, second.token),
        code: 'CONFLICT',
      });
      await createBotSeat(fixture, roundId, 'judge', 1);
      const prepared = {
        roundId,
        principal: {
          kind: 'agent' as const,
          serviceId: second.scope.serviceId,
          agentRunId: second.scope.agentRunId,
          participantId: seat.id,
          roundId,
        },
        envelope: {
          version: 1 as const,
          commandId: second.scope.commandId,
          expectedVersion: second.expectedVersion,
          judgeParticipantId: seat.id,
          freezeRevision: second.frozen.revision,
          ballot,
        },
        payloadDigest: 'c'.repeat(64),
        nextBallotId: createId,
        authorize: (
          context: import('../src/round-ballot-operations').LockedRoundBallotContext,
        ) => {
          if (context.authority.agentRun?.id !== second.scope.agentRunId)
            throw createAppError('AUTHORIZATION');
        },
        // This adapter component proof deliberately leaves the other actual judge pending.
        buildProjection: () => null,
      };
      await assertRejects({
        given: 'a substituted ballot body after a validated durable response',
        should: 'refuse before any ballot or cache mutation',
        actual: () =>
          jobs.submitResult(second.scope, second.token, {
            ...prepared,
            envelope: {
              ...prepared.envelope,
              ballot: { ...ballot, winner: 'negative' },
            },
          }),
        code: 'CONFLICT',
      });
      const receipt = await jobs.submitResult(
        second.scope,
        second.token,
        prepared,
      );
      const [settled] =
        await fixture.sql`select status,pending_ballot,result_ballot_id from round_judging_jobs where round_id=${roundId}`;
      const [ended] =
        await fixture.sql`select ended_at from agent_runs where id=${second.scope.agentRunId}`;
      assert({
        given: 'the actual locked nonfinal shared ballot writer',
        should:
          'atomically submit, clear only the matched response, and end its run',
        actual: [
          receipt.outcome,
          settled!.status,
          settled!.pending_ballot,
          settled!.result_ballot_id,
          ended!.ended_at !== null,
        ],
        expected: [null, 'succeeded', null, receipt.ballotId, true],
      });
    } finally {
      await fixture.sql`delete from rounds where id=${roundId}`;
    }
  });
});
