import { assert, setupRitewayBun, test } from 'riteway/bun';
import { view, aff, neg } from '../../ui/debate-room/live-round.test-support';
import { readRoundRatings } from './read-round';
setupRitewayBun();

test('a historical Round badge uses its posting rather than later established standing', async () => {
  const seasonId = 's'.repeat(24);
  const at = '2026-10-28T00:00:00.000Z';
  const result = await readRoundRatings(
    {
      listLadderSeasons: async () => [
        {
          id: seasonId,
          name: 'Season 1',
          startsAt: at,
          endsAt: null,
          status: 'active',
          version: 1,
        },
      ],
      readRatingBlindings: async () => [],
      readStandings: async () => ({
        ratings: [aff, neg].map((p) => ({
          seasonId,
          actorId: p.actorId,
          username: p.label,
          accountClosed: false,
          rating: 1800,
          deviation: 90,
          volatility: 0.06,
        })),
        changes: [aff, neg].map((p) => ({
          seasonId,
          actorId: p.actorId,
          roundId: view.id,
          ratingBefore: 1500,
          ratingAfter: 1600,
          deviationBefore: 350,
          deviationAfter: 200,
          occurredAt: at,
          role: p === aff ? ('affirmative' as const) : ('negative' as const),
          outcome: 'affirmative' as const,
        })),
      }),
    },
    {
      round: {
        ...view,
        ladderId: 'freestyle',
        status: 'completed',
        outcome: 'affirmative',
      },
      now: at,
      viewerActorId: null,
    },
  );
  assert({
    given:
      'a posted RD200 result followed by an established current RD90 standing',
    should: 'keep the original rating and provisional badge together',
    actual: result?.rows.map((r) => [r.rating, r.provisional]),
    expected: [
      [1600, true],
      [1600, true],
    ],
  });
});
