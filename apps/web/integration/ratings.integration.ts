import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { rateDebate, ratingPolicy } from '@daisy/debate-engine';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { inArena, minute } from './ratings-arena';
import { withSql } from './fixtures';

requireTestServices(process.env);
setupRitewayBun();

const newcomers = (outcome: 'affirmative' | 'negative' | 'draw') =>
  rateDebate({
    affirmative: { state: ratingPolicy.initial, lastRatedAt: null },
    negative: { state: ratingPolicy.initial, lastRatedAt: null },
    outcome,
    occurredAt: minute(30),
  });

const stateOf = (row?: { rating: number; deviation: number }) =>
  row && { rating: row.rating, deviation: row.deviation };

describe('rating a completed round with the engine decision (RATE-1.3)', () => {
  test('writes exactly the engine calculation, once', async () => {
    await inArena(async ({ actor, round, rate, ratings }) => {
      const [affirmative, negative] = [await actor(), await actor()];
      const roundId = await round({ affirmative, negative });
      const result = await rate(roundId);
      const expected = newcomers('negative');
      assert({
        given:
          'a completed ranked round won by the negative, constructed from its ladder',
        should:
          'store the engine calculation for both debaters on the ranked ladder at version 1',
        actual: [
          result.kind,
          await ratings(negative),
          await ratings(affirmative),
        ],
        expected: [
          'rated',
          [
            {
              ladder: 'ranked',
              rating: expected.negative.after.rating,
              deviation: expected.negative.after.deviation,
              version: 1,
            },
          ],
          [
            {
              ladder: 'ranked',
              rating: expected.affirmative.after.rating,
              deviation: expected.affirmative.after.deviation,
              version: 1,
            },
          ],
        ],
      });
      assert({
        given: 'the same round rated again',
        should: 'report it already rated',
        actual: (await rate(roundId)).kind,
        expected: 'already-rated',
      });
    });
  });

  test('rates quick-length rounds, draws and forfeits on their own ladder', async () => {
    await inArena(async ({ actor, round, rate, ratings }) => {
      const [first, second] = [await actor(), await actor()];
      const quick = await round({
        affirmative: first,
        negative: second,
        length: 'quick',
        outcome: 'draw',
      });
      const quickResult = await rate(quick);
      const draw = newcomers('draw');
      assert({
        given: 'a drawn quick-length ranked round between newcomers',
        should: 'rate it on the quick ladder only, as the engine rates a draw',
        actual: [
          quickResult.kind === 'rated' && quickResult.ladder,
          (await ratings(first)).map(({ ladder }) => ladder),
          stateOf((await ratings(first))[0]),
        ],
        expected: [
          'quick',
          ['quick'],
          {
            rating: draw.affirmative.after.rating,
            deviation: draw.affirmative.after.deviation,
          },
        ],
      });
      const [third, fourth] = [await actor(), await actor()];
      const forfeit = await round({
        affirmative: third,
        negative: fourth,
        outcome: 'affirmative',
      });
      const won = newcomers('affirmative');
      assert({
        given: 'a ranked forfeit: a side outcome and no ballot',
        should: 'rate it exactly like a judged win',
        actual: [
          (await rate(forfeit)).kind,
          stateOf((await ratings(third))[0]),
        ],
        expected: [
          'rated',
          {
            rating: won.affirmative.after.rating,
            deviation: won.affirmative.after.deviation,
          },
        ],
      });
    });
  });

  test('never rates practice, abandoned or unfinished rounds', async () => {
    await inArena(async ({ actor, round, rate, ledger }) => {
      const [first, second] = [await actor(), await actor()];
      const results = [
        await rate(
          await round({
            affirmative: first,
            negative: second,
            competitionType: 'casual',
          }),
        ),
        await rate(
          await round({
            affirmative: first,
            negative: second,
            status: 'abandoned',
          }),
        ),
      ];
      assert({
        given: 'a casual round and an abandoned ranked round',
        should: 'leave each unrated for its reason and write nothing',
        actual: [results, (await ledger(first)).length],
        expected: [
          [
            { kind: 'unrated', reason: 'competition' },
            { kind: 'unrated', reason: 'abandoned' },
          ],
          0,
        ],
      });
      const active = await round({
        affirmative: first,
        negative: second,
        status: 'active',
      });
      await assertRejects({
        given: 'a ranked round that has not completed',
        should: 'refuse as a conflict',
        actual: () => rate(active),
        code: 'CONFLICT',
      });
    });
  });

  test('refuses to rate without an active season', async () => {
    await inArena(
      async ({ actor, round, rate, ledger }) => {
        const first = await actor();
        const roundId = await round({
          affirmative: first,
          negative: await actor(),
        });
        await assertRejects({
          given: 'no active season',
          should: 'refuse as a conflict',
          actual: () => rate(roundId),
          code: 'CONFLICT',
        });
        assert({
          given: 'a refused rating',
          should: 'write nothing',
          actual: (await ledger(first)).length,
          expected: 0,
        });
      },
      { season: false },
    );
  });

  test('carries an earlier season into the active one', async () => {
    await inArena(async ({ formatId, season, actor, round, rate, ledger }) => {
      const veteran = await actor();
      const earlier = await season('closed', '2026-06-01T00:00:00.000Z');
      await withSql(
        (
          sql,
        ) => sql`insert into ratings (actor_id, format_id, season_id, ladder, rating, deviation, volatility)
          values (${veteran}, ${formatId}, ${earlier}, 'ranked', 1720, 60, 0.05)`,
      );
      await rate(
        await round({ affirmative: veteran, negative: await actor() }),
      );
      const [row] = await ledger(veteran);
      assert({
        given: 'a debater rated only in an earlier season',
        should:
          'start this season from the carried rating with the deviation widened to 150',
        actual: [row?.rating_before, row?.deviation_before],
        expected: [1720, 150],
      });
    });
  });
});
