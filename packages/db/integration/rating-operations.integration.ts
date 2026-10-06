import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import {
  completedAt,
  ledgerOf,
  ratingsOf,
  withRatings,
} from './rating-fixtures';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

const ledgerRow = (actor: string, after: number, season: string) => ({
  actor,
  ladder: 'ranked',
  before: 1500,
  after,
  version: 'stub-v1',
  occurredAt: completedAt(30).toISOString(),
  season,
});

describe('rateDebate (RATE-1.3)', () => {
  test('writes the decided ledger rows and projection once', async () => {
    await withRatings(url, async ({ fixture, rate, seated }) => {
      const { seasonId, debateId, affirmative, negative } = await seated();
      const result = await rate(debateId);
      assert({
        given: 'a completed ranked debate',
        should: 'report it rated on the ranked ladder in the active season',
        actual: result.kind === 'rated' && [result.ladder, result.seasonId],
        expected: ['ranked', seasonId],
      });
      assert({
        given: 'the decided changes',
        should:
          'write one ledger row per side at the debate completion with the decision version',
        actual: (await ledgerOf(fixture, debateId)).map((row) => ({
          actor: row.actor_id,
          ladder: row.ladder,
          before: row.rating_before,
          after: row.rating_after,
          version: row.calculation_version,
          occurredAt: row.occurred_at.toISOString(),
          season: row.season_id,
        })),
        expected: [
          ledgerRow(affirmative, 1510, seasonId),
          ledgerRow(negative, 1490, seasonId),
        ],
      });
      assert({
        given: 'two newcomers rated',
        should: 'insert their projections at version 1',
        actual: [
          await ratingsOf(fixture, affirmative),
          await ratingsOf(fixture, negative),
        ],
        expected: [
          [{ ladder: 'ranked', rating: 1510, deviation: 349, version: 1 }],
          [{ ladder: 'ranked', rating: 1490, deviation: 349, version: 1 }],
        ],
      });
      const rerun = await rate(debateId);
      assert({
        given: 'the same debate rated again',
        should: 'report it already rated and change nothing',
        actual: [
          rerun.kind,
          (await ledgerOf(fixture, debateId)).length,
          (await ratingsOf(fixture, affirmative))[0]?.version,
        ],
        expected: ['already-rated', 2, 1],
      });
    });
  });

  test('rates one debate once under concurrent attempts', async () => {
    await withRatings(url, async ({ fixture, rate, seated }) => {
      const { debateId } = await seated();
      const results = await Promise.all([0, 1, 2].map(() => rate(debateId)));
      assert({
        given: 'three concurrent attempts to rate one debate',
        should: 'rate it exactly once',
        actual: [
          results.filter(({ kind }) => kind === 'rated').length,
          results.filter(({ kind }) => kind === 'already-rated').length,
          (await ledgerOf(fixture, debateId)).length,
        ],
        expected: [1, 2, 2],
      });
    });
  });

  test('loses no update when debates sharing a debater are rated together', async () => {
    await withRatings(url, async ({ fixture, rate, seated }) => {
      const one = await seated({ minute: 30 });
      const two = await seated({
        formatId: one.formatId,
        affirmative: one.affirmative,
        minute: 40,
      });
      const shared = one.affirmative;
      const results = await Promise.all([
        rate(one.debateId),
        rate(two.debateId),
      ]);
      const sharedRows = [
        ...(await ledgerOf(fixture, one.debateId)),
        ...(await ledgerOf(fixture, two.debateId)),
      ]
        .filter(({ actor_id }) => actor_id === shared)
        .sort((a, b) => a.rating_after - b.rating_after);
      assert({
        given: 'two debates won by one debater, rated concurrently',
        should:
          'rate both, chain the second from the first, and leave the projection at version 2',
        actual: {
          kinds: results.map(({ kind }) => kind),
          chain: sharedRows.map(({ rating_before, rating_after }) => [
            rating_before,
            rating_after,
          ]),
          projection: await ratingsOf(fixture, shared),
        },
        expected: {
          kinds: ['rated', 'rated'],
          chain: [
            [1500, 1510],
            [1510, 1520],
          ],
          projection: [
            { ladder: 'ranked', rating: 1520, deviation: 348, version: 2 },
          ],
        },
      });
    });
  });

  test('rates debates with swapped sides concurrently without deadlocking', async () => {
    await withRatings(url, async ({ fixture, rate, seated }) => {
      const results = [];
      for (let round = 0; round < 5; round += 1) {
        const one = await seated({ minute: 30 + round });
        const two = await seated({
          formatId: one.formatId,
          affirmative: one.negative,
          negative: one.affirmative,
          minute: 30 + round,
        });
        results.push(
          ...(await Promise.all([rate(one.debateId), rate(two.debateId)])),
        );
        assert({
          given: `round ${round}: two debates between the same pair with sides swapped`,
          should: 'leave both projections at version 2',
          actual: (await ratingsOf(fixture, one.affirmative))[0]?.version,
          expected: 2,
        });
      }
      assert({
        given: 'ten concurrent ratings in reversed side orders',
        should: 'rate every debate',
        actual: results.every(({ kind }) => kind === 'rated'),
        expected: true,
      });
    });
  });
});
