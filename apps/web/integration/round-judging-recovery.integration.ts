import { randomBytes } from 'node:crypto';
import { requireTestServices } from '@daisy/config';
import {
  oneOnOneDefinition,
  practiceRoomConfig,
} from '@daisy/db/reference-formats';
import { assertRejects } from '@daisy/errors/testing';
import { isAppError } from '@daisy/errors';
import { ballotCategories, type Ballot } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundJudgingOperations } from '../src/features/round-judging/operations';
import { createRoundFinalizationOperations } from '../src/features/round-finalization/operations';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);
const ballot: Ballot = {
  rubricVersion: 'speaker-10@1',
  winner: 'affirmative',
  reason: 'Fixture response for durable recovery, not provider evidence.',
  feedback: {},
  scores: Object.fromEntries(
    ['affirmative', 'negative'].map((side) => [
      side,
      Object.fromEntries(ballotCategories.map((key) => [key, 3])),
    ]),
  ) as Ballot['scores'],
};
test('cached judging response retries actual shared completion without redispatch during unresolved attendance', async () => {
  await withRoomRuntime(
    async (f) => {
      const judge = await f.bot();
      let room = await f.assemble({
        selection: {
          kind: 'custom',
          definition: {
            ...oneOnOneDefinition,
            seats: { ...oneOnOneDefinition.seats, judge: 1 },
          },
          config: practiceRoomConfig,
          length: 'full',
          competitionType: 'casual',
        },
      });
      room = (
        await f.command(f.host, room, {
          type: 'assign-seat',
          role: 'judge',
          slot: 0,
          actorId: judge.actorId,
        })
      ).view;
      for (const caller of [f.host, f.guest])
        room = (
          await f.consent(
            caller,
            await f.operations.view(caller, room.id),
            'ready',
          )
        ).view;
      const { roundId } = await startRuntimeRound(f, room);
      const round = (await f.store.getRound(roundId))!;
      const elapsed = round.rules.segments.reduce(
        (n, s) => n + s.durationMs + round.rules.countdownMs,
        125000,
      );
      await f.sql`update rounds set started_at=clock_timestamp()-${elapsed}*interval '1 millisecond' where id=${roundId}`;
      await createRoundFinalizationOperations({
        store: f.store,
        nextSegmentId: createId,
      }).finalize(roundId);
      const target = (await f.store.scanRoundJudgingJobs(1))[0]!;
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
      botBusyCap: 4,
      judging: {
        leaseMs: 60000,
        model: 'fixture-model',
        nextToken: () => randomBytes(32).toString('base64url'),
      },
    },
  );
});
