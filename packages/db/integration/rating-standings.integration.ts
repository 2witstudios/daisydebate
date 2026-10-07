import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import type { RatingPlanFacts } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ledgerOf, ratingsOf, stub, withRatings } from './rating-fixtures';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

describe('rateDebate standings and refusals (RATE-1.3)', () => {
  test('loads each standing on the debate ladder, carrying an earlier season', async () => {
    await withRatings(url, async ({ fixture, rate, seated }) => {
      const formatId = await fixture.format();
      const veteran = await fixture.actor();
      const earlier = createId();
      await fixture.insert('seasons', {
        id: earlier,
        name: 'Earlier',
        starts_at: new Date('2026-01-01T00:00:00.000Z'),
        ends_at: new Date('2026-06-01T00:00:00.000Z'),
        status: 'closed',
      });
      await fixture.insert(
        'ratings',
        {
          actor_id: veteran,
          format_id: formatId,
          season_id: earlier,
          ladder: 'quick',
          rating: 1700,
          deviation: 60,
          volatility: 0.05,
        },
        'actor_id',
      );
      const { seasonId, roundId, negative } = await seated({
        formatId,
        affirmative: veteran,
        length: 'quick',
      });
      const seen: RatingPlanFacts[] = [];
      await rate(roundId, stub(seen));
      assert({
        given: 'a quick match by a debater rated only in an earlier season',
        should:
          'load no current row and the earlier quick state, and leave the earlier row untouched',
        actual: {
          ladder: seen[0]?.ladder,
          season: seen[0]?.seasonId,
          veteran: seen[0]?.standings[veteran],
          rival: seen[0]?.standings[negative],
          ratings: await ratingsOf(fixture, veteran),
        },
        expected: {
          ladder: 'quick',
          season: seasonId,
          veteran: {
            current: null,
            previous: { rating: 1700, deviation: 60, volatility: 0.05 },
            lastRatedAt: null,
          },
          rival: { current: null, previous: null, lastRatedAt: null },
          ratings: [
            { ladder: 'quick', rating: 1700, deviation: 60, version: 1 },
            { ladder: 'quick', rating: 1710, deviation: 59, version: 1 },
          ],
        },
      });
    });
  });

  test('writes nothing for an unrated debate and refuses an unknown one', async () => {
    await withRatings(url, async ({ fixture, rate, seated }) => {
      const { roundId, affirmative } = await seated({
        competitionType: 'casual',
      });
      const result = await rate(roundId);
      assert({
        given: 'a completed casual debate',
        should: 'report it unrated and write nothing',
        actual: [
          result,
          (await ledgerOf(fixture, roundId)).length,
          await ratingsOf(fixture, affirmative),
        ],
        expected: [{ kind: 'unrated', reason: 'competition' }, 0, []],
      });
      await assertRejects({
        given: 'an unknown debate id',
        should: 'refuse as not found',
        actual: () => rate(createId()),
        code: 'NOT_FOUND',
      });
    });
  });
});
