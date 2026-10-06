import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { rateDebate, ratingPolicy } from '@daisy/debate-engine';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { inArena, minute, rules } from './ratings-arena';
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

describe('rating a completed debate with the engine decision (RATE-1.3)', () => {
  test('writes exactly the engine calculation, once', async () => {
    await inArena(async ({ actor, debate, rate, ratings }) => {
      const [affirmative, negative] = [await actor(), await actor()];
      const debateId = await debate({ affirmative, negative });
      const result = await rate(debateId);
      const expected = newcomers('negative');
      assert({
        given:
          'a completed ranked debate on canonical rules won by the negative',
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
        given: 'the same debate rated again',
        should: 'report it already rated',
        actual: (await rate(debateId)).kind,
        expected: 'already-rated',
      });
    });
  });

  test('rates quick matches, draws and forfeits on their own ladder', async () => {
    await inArena(async ({ actor, debate, rate, ratings }) => {
      const [first, second] = [await actor(), await actor()];
      const quick = await debate({
        affirmative: first,
        negative: second,
        mode: 'quick',
        outcome: 'draw',
      });
      const quickResult = await rate(quick);
      const draw = newcomers('draw');
      assert({
        given: 'a drawn quick match between newcomers',
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
      const forfeit = await debate({
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

  test('never rates practice, abandoned, overridden or unfinished debates', async () => {
    await inArena(async ({ actor, debate, rate, ledger }) => {
      const [first, second] = [await actor(), await actor()];
      const results = [
        await rate(
          await debate({
            affirmative: first,
            negative: second,
            mode: 'practice',
          }),
        ),
        await rate(
          await debate({
            affirmative: first,
            negative: second,
            outcome: 'abandoned',
          }),
        ),
        await rate(
          await debate({
            affirmative: first,
            negative: second,
            rules: { ...rules, clock: { speechMs: 60_000, prepMs: 0 } },
          }),
        ),
      ];
      assert({
        given:
          'a practice debate, an abandoned ranked debate and a ranked debate under overridden rules',
        should: 'leave each unrated for its reason and write nothing',
        actual: [results, (await ledger(first)).length],
        expected: [
          [
            { kind: 'unrated', reason: 'mode' },
            { kind: 'unrated', reason: 'abandoned' },
            { kind: 'unrated', reason: 'rules' },
          ],
          0,
        ],
      });
      const active = await debate({
        affirmative: first,
        negative: second,
        phase: 'active',
      });
      await assertRejects({
        given: 'a ranked debate that has not completed',
        should: 'refuse as a conflict',
        actual: () => rate(active),
        code: 'CONFLICT',
      });
    });
  });

  test('never rates a format that is not ranked-eligible', async () => {
    await inArena(
      async ({ actor, debate, rate }) => {
        const debateId = await debate({
          affirmative: await actor(),
          negative: await actor(),
        });
        assert({
          given:
            'a completed ranked debate on a format that is not ranked-eligible',
          should: 'leave it unrated for its rules',
          actual: await rate(debateId),
          expected: { kind: 'unrated', reason: 'rules' },
        });
      },
      { rankedEligible: false },
    );
  });

  test('refuses to rate without an active season', async () => {
    await inArena(
      async ({ actor, debate, rate, ledger }) => {
        const first = await actor();
        const debateId = await debate({
          affirmative: first,
          negative: await actor(),
        });
        await assertRejects({
          given: 'no active season',
          should: 'refuse as a conflict',
          actual: () => rate(debateId),
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
    await inArena(async ({ formatId, season, actor, debate, rate, ledger }) => {
      const veteran = await actor();
      const earlier = await season('closed', '2026-06-01T00:00:00.000Z');
      await withSql(
        (
          sql,
        ) => sql`insert into ratings (actor_id, format_id, season_id, ladder, rating, deviation, volatility)
          values (${veteran}, ${formatId}, ${earlier}, 'ranked', 1720, 60, 0.05)`,
      );
      await rate(
        await debate({ affirmative: veteran, negative: await actor() }),
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
