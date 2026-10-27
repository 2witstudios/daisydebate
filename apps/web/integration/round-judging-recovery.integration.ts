import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { isAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundJudgingOperations } from '../src/features/round-judging/operations';
import { withRoomRuntime } from './round-runtime.test-support';
import { fixtureBallot, freezeBotJudge } from './round-judging.test-support';
import { botAdmissionForTests } from './bot-admission.test-support';
setupRitewayBun();
requireTestServices(process.env);
const ballot = fixtureBallot(
  'Fixture response for durable recovery, not provider evidence.',
);
test('cached judging response retries actual shared completion without redispatch during unresolved attendance', async () => {
  await withRoomRuntime(
    async (f) => {
      const { roundId, target } = await freezeBotJudge(f);
      const first = await f.store.claimRoundJudgingJob(target);
      await f.store.beginRoundJudgingModelCall(first.scope, first.token);
      await f.store.saveRoundJudgingResult(first.scope, first.token, ballot, {
        inputTokens: 11,
        outputTokens: 5,
      });
      const operations = createRoundJudgingOperations({
        store: f.store,
        nextId: createId,
        voice: () => {
          throw Error('Cached retry must not instantiate provider');
        },
        withProvider: async () => {
          throw Error('Cached retry must not acquire provider slot');
        },
      });
      await f.sql`update round_judging_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${roundId}`;
      const takeover = await f.store.claimRoundJudgingJob(target);
      const refusals: string[] = [];
      for (let retry = 0; retry < 2; retry++)
        await assertRejects({
          given:
            'a cached response on a new epoch with unresolved actual speech',
          should: 'refuse shared completion',
          actual: async () => {
            try {
              return await operations.executeClaim(
                takeover,
                new AbortController().signal,
              );
            } catch (error) {
              if (isAppError(error)) refusals.push(error.message);
              throw error;
            }
          },
          code: 'CONFLICT',
        });
      const [stored] =
        await f.sql`select pending_ballot,pending_ballot_epoch,attempts,status,result_ballot_id from round_judging_jobs where round_id=${roundId}`;
      const [counts] =
        await f.sql`select (select sum(requests)::int from agent_runs where round_participant_id=${target.judgeParticipantId}) requests,(select count(*)::int from ballots where judge_participant_id=${target.judgeParticipantId}) ballots`;
      assert({
        given: 'two blocked actual shared submissions after takeover',
        should:
          'retain the original cache, one dispatch intent and no completion',
        actual: [
          refusals,
          stored.pending_ballot,
          stored.pending_ballot_epoch,
          stored.attempts,
          stored.status,
          stored.result_ballot_id,
          counts.requests,
          counts.ballots,
          (await f.store.getRound(roundId))!.status,
        ],
        expected: [
          ['attendance-unsettled', 'attendance-unsettled'],
          ballot,
          1,
          2,
          'leased',
          null,
          1,
          0,
          'active',
        ],
      });
    },
    {
      ...botAdmissionForTests,
      judging: {
        leaseMs: 60000,
        model: 'fixture-model',
        nextToken: () => randomBytes(32).toString('base64url'),
      },
    },
  );
});
