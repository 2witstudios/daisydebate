import { requireTestServices } from '@daisy/config';
import {
  planRating,
  rateDebate,
  ratingEligibility,
  ratingPolicy,
} from '@daisy/debate-engine';
import { assertRejects, rejectionOf } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  ballotCommand,
  inSeason,
  readLedger,
  readVersions,
  ruling,
  withWebInstances,
} from './judged-rating.test-support';
import {
  cachedAiJudgingRuntime,
  frozenRatedRound,
  judgeWithCachedAi,
  recoverRatedResults,
} from './rated-room.test-support';
import { withRoomRuntime } from './round-runtime.test-support';
import type { Ballot } from '@daisy/protocol';

requireTestServices(process.env);
setupRitewayBun();
type Side = Ballot['winner'];

for (const judgeKind of ['human', 'ai'] as const)
  for (const outcome of ['affirmative', 'negative'] as const)
    test(`${judgeKind} ballot for ${outcome}: two web instances post the engine's result once and replay moves nothing`, async () => {
      await withRoomRuntime(async (f) => {
        await inSeason(f, async () => {
          const { roundId, freezeRevision } = await frozenRatedRound(
            f,
            'policy',
            judgeKind,
          );
          const replay =
            judgeKind === 'human'
              ? await (async () => {
                  const submit = await ballotCommand(
                    f,
                    roundId,
                    f.outsider.actorId,
                    freezeRevision,
                    outcome,
                  );
                  const receipt = await submit();
                  return { submit, receipt };
                })()
              : await judgeWithCachedAi(f, roundId, ruling(outcome));
          const done = (await f.store.getRound(roundId))!;
          await withWebInstances(f, 2, async (instances) => {
            const awaited = await f.store.readRoundAwaitsRating(roundId);
            await Promise.all(instances.map((i) => i.rateUnrated()));
            const first = await readLedger(f, roundId);
            const newcomer = { state: ratingPolicy.initial, lastRatedAt: null };
            const rated = rateDebate({
              affirmative: newcomer,
              negative: newcomer,
              outcome,
              occurredAt: done.completedAt!,
            });
            const seats = done.participants;
            const sideOf = (actorId: string) =>
              seats.find((p) => p.actorId === actorId)!.role as Side;
            assert({
              given: `a ranked Round decided ${outcome} by a ${judgeKind} ballot and two racing maintenance instances`,
              should:
                'post exactly the engine result for that winner, once for each debater',
              actual: {
                done: [done.status, done.outcome],
                awaited,
                rows: first.map((row) => [
                  sideOf(row.actor_id),
                  row.rating_before,
                  row.rating_after,
                  row.deviation_after,
                  row.volatility_after,
                ]),
                versions: await readVersions(f),
                awaitsAfter: await f.store.readRoundAwaitsRating(roundId),
              },
              expected: {
                done: ['completed', outcome],
                awaited: true,
                rows: first.map((row) => {
                  const side = sideOf(row.actor_id);
                  return [
                    side,
                    ratingPolicy.initial.rating,
                    rated[side].after.rating,
                    rated[side].after.deviation,
                    rated[side].after.volatility,
                  ];
                }),
                versions: [1, 1],
                awaitsAfter: false,
              },
            });
            const winnerRow = first.find(
              (row) => sideOf(row.actor_id) === outcome,
            )!;
            assert({
              given: `the ledger of a ${outcome} win`,
              should: 'raise the winner above the starting rating',
              actual:
                first.length === 2 &&
                winnerRow.rating_after > winnerRow.rating_before,
              expected: true,
            });
            if ('submit' in replay) {
              assert({
                given: 'the same ballot command delivered again after posting',
                should: 'return the original receipt',
                actual: await replay.submit(),
                expected: replay.receipt,
              });
            } else {
              assert({
                given: 'the finished AI judging claim executed again',
                should: 'refuse it, because its lease ended with the ballot',
                actual: await rejectionOf(() =>
                  replay.judging.executeClaim(
                    replay.claim,
                    new AbortController().signal,
                  ),
                ),
                expected: { code: 'CONFLICT' },
              });
            }
            await Promise.all(instances.map((i) => i.rateUnrated()));
            await recoverRatedResults(f);
            assert({
              given: `a replayed ${judgeKind} ballot and further sweeps after posting`,
              should: 'leave the ledger and both projections untouched',
              actual: {
                ledger: await readLedger(f, roundId),
                versions: await readVersions(f),
                ballots: (
                  await f.sql`select id from ballots where round_id=${roundId}`
                ).length,
              },
              expected: { ledger: first, versions: [1, 1], ballots: 1 },
            });
          });
        });
      }, cachedAiJudgingRuntime);
    });

test('a posting that fails after its ledger insert leaves nothing and the next sweep posts once', async () => {
  await withRoomRuntime(async (f) => {
    await inSeason(f, async () => {
      const { roundId, freezeRevision } = await frozenRatedRound(
        f,
        'policy',
        'human',
      );
      await (
        await ballotCommand(
          f,
          roundId,
          f.outsider.actorId,
          freezeRevision,
          'affirmative',
        )
      )();
      // The projection write sees a version that no longer exists, after the
      // ledger rows of the same transaction were inserted.
      await assertRejects({
        given: 'a projection write that keeps failing inside the posting',
        should: 'give up with a conflict',
        code: 'CONFLICT',
        actual: () =>
          f.store.rateRound({
            roundId,
            changeIds: [createId(), createId()],
            decide: {
              eligibility: ratingEligibility,
              plan: (facts) => {
                const plan = planRating(facts);
                return {
                  ...plan,
                  changes: plan.changes.map((change) => ({
                    ...change,
                    expectedVersion: 99,
                  })),
                };
              },
            },
          }),
      });
      assert({
        given: 'the failed posting',
        should: 'roll back its ledger rows and still await a rating',
        actual: {
          rows: (await readLedger(f, roundId)).length,
          versions: await readVersions(f),
          awaits: await f.store.readRoundAwaitsRating(roundId),
        },
        expected: { rows: 0, versions: [], awaits: true },
      });
      await recoverRatedResults(f);
      const ledger = await readLedger(f, roundId);
      assert({
        given: 'the next sweeps after the failure',
        should: 'post both debaters once, from their starting ratings',
        actual: {
          rows: ledger.length,
          before: ledger.map((row) => row.rating_before),
          versions: await readVersions(f),
        },
        expected: {
          rows: 2,
          before: [ratingPolicy.initial.rating, ratingPolicy.initial.rating],
          versions: [1, 1],
        },
      });
    });
  });
});
