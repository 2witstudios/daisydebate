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
  assert({
    given: 'a Round the ladder posted',
    should: 'say it rated',
    actual: result?.posting,
    expected: 'rated',
  });
});

test('a blinded debater hides the posting, and only both blinded hide that it rated', async () => {
  const read = (blinded: readonly string[]) =>
    readRoundRatings(
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
        readRatingBlindings: async () => blinded,
        readRatingFacts: async () => null,
        readStandings: async () => ({
          ratings: [aff, neg].map((p) => ({
            seasonId,
            actorId: p.actorId,
            username: p.label,
            accountClosed: false,
            rating: 1600,
            deviation: 200,
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
        viewerActorId: 'judge-viewer',
      },
    );
  const seen = async (blinded: readonly string[]) => {
    const result = await read(blinded);
    return [result?.posting, result?.rows.map((row) => row.hidden ?? false)];
  };
  assert({
    given: 'a viewer judging both debaters elsewhere',
    should: 'hide both rows and not say it rated',
    actual: await seen([aff.actorId, neg.actorId]),
    expected: ['none', [true, true]],
  });
  assert({
    given: 'a viewer judging one debater elsewhere',
    should: 'hide that row and still say it rated, as the other row shows',
    actual: await seen([aff.actorId]),
    expected: ['rated', [true, false]],
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
    actual: [(await read(true))?.posting, (await read(false))?.posting],
    expected: ['pending', 'none'],
  });
});
