import { assert, setupRitewayBun, test } from 'riteway/bun';
import { view, aff, neg } from '../../ui/debate-room/live-round.test-support';
import { readRoundRatings } from './read-round';
setupRitewayBun();

const seasonId = 's'.repeat(24);
const at = '2026-10-28T00:00:00.000Z';

test('a historical Round badge uses its posting rather than later established standing', async () => {
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
      readRatingFacts: async () => null,
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

test('a decided Round is pending exactly when the rating writer would still rate it', async () => {
  const read = (awaits: boolean) =>
    readRoundRatings(
      {
        listLadderSeasons: async () => [
          {
            id: seasonId,
            name: 'Season',
            startsAt: at,
            endsAt: null,
            status: 'active',
            version: 1,
          },
        ],
        readRatingBlindings: async () => [],
        readStandings: async () => ({ ratings: [], changes: [] }),
        readRatingFacts: async () =>
          awaits
            ? {
                competitionType: 'ranked',
                ladderId: 'freestyle',
                status: 'completed',
                outcome: 'affirmative',
                completedAt: at,
                alreadyRated: false,
                ending: 'forfeit',
                attendance: {
                  ruleSegments: [],
                  speeches: [],
                  adjudications: [],
                  receipts: [],
                  pendingWriter: false,
                },
              }
            : null,
      } as never,
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
    given: 'a decided Round with no postings yet',
    should: "answer with the writer's predicate",
    actual: [(await read(true))?.pending, (await read(false))?.pending],
    expected: [true, false],
  });
});
