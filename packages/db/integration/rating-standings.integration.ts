import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import type { RatingPlanFacts } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ledgerOf, ratingsOf, stub, withRatings } from './rating-fixtures';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

describe('rateDebate standings and refusals (RATE-1.3)', () => {
  test('refuses unapproved future carry-over without mutation', async () => {
    await withRatings(url, async ({ fixture, rate, seated }) => {
      const formatId = 'freestyle';
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
          season_id: earlier,
          ladder: 'freestyle',
          rating: 1700,
          deviation: 60,
          volatility: 0.05,
        },
        'actor_id',
      );
      const { roundId } = await seated({
        formatId,
        affirmative: veteran,
      });
      const seen: RatingPlanFacts[] = [];
      await assertRejects({
        given:
          'an earlier-season standing while DEC111 carry-over is unresolved',
        should:
          'refuse before invoking a plan and preserve the earlier standing unchanged',
        actual: () => rate(roundId, stub(seen)),
        code: 'CONFLICT',
      });
      assert({
        given: 'the refused posting',
        should: 'write no ledger or current projection',
        actual: {
          seen: seen.length,
          ledger: (await ledgerOf(fixture, roundId)).length,
          ratings: await ratingsOf(fixture, veteran),
        },
        expected: {
          seen: 0,
          ledger: 0,
          ratings: [
            { ladder: 'freestyle', rating: 1700, deviation: 60, version: 1 },
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
