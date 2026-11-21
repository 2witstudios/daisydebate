import { officialRatingLadders } from './standing.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  asCompleted,
  view,
  aff,
  neg,
} from '../../ui/debate-room/live-round.test-support';
import { readRoundRatings } from './read-round';
import { rateDebateSides } from '@daisy/debate-engine';
import { sideSeat, winnerOutcome } from '@daisy/protocol';
setupRitewayBun();

const seasonId = 's'.repeat(24);
const at = '2026-10-28T00:00:00.000Z';
const youth = { style: 'freestyle', division: 'youth' } as const;

test('team stakes use each debater’s own standing and the whole opposing side', async () => {
  const participants = [
    { ...aff, seat: sideSeat('affirmative') },
    { ...aff, actorId: 'second-affirmative', seat: sideSeat('affirmative', 1) },
    { ...neg, seat: sideSeat('negative') },
    { ...neg, actorId: 'second-negative', seat: sideSeat('negative', 1) },
  ];
  const ratings = participants.map((p, index) => ({
    seasonId,
    actorId: p.actorId,
    username: p.label,
    accountClosed: false,
    rating: 1300 + index * 155,
    deviation: 110 + index * 35,
    volatility: 0.06,
  }));
  const states = ratings.map((state) => ({ state, lastRatedAt: null }));
  const changed = (side: string) =>
    rateDebateSides({
      affirmative: states.slice(0, 2),
      negative: states.slice(2),
      occurredAt: at,
      outcome: winnerOutcome(side),
    });
  const left = changed('affirmative');
  const right = changed('negative');
  const wins = [...left.affirmative, ...right.negative];
  const losses = [...right.affirmative, ...left.negative];
  const result = await readRoundRatings(
    {
      listOfficialRatingLadders: officialRatingLadders,
      listLadderSeasons: async () => [
        {
          id: seasonId,
          name: 'Season 1',
          startsAt: at,
          endsAt: null,
          status: 'active',
          lobbyId: 'youth',
          version: 1,
        },
      ],
      readRatingBlindings: async () => [],
      readRatingFacts: async () => null,
      readStandings: async () => ({ ratings, changes: [] }),
    },
    {
      round: { ...view, ladder: youth, participants },
      now: at,
      viewerActorId: null,
    },
  );
  assert({
    given: 'two sides with distinct pre-game standings for all four debaters',
    should:
      'show each of the four win and loss changes from the shared rating calculation',
    actual: result?.rows.map(({ win, loss }) => [win, loss]),
    expected: ratings.map((row, index) => [
      Math.round(wins[index]!.after.rating - row.rating),
      Math.round(losses[index]!.after.rating - row.rating),
    ]),
  });
});

test('a historical Round badge uses its posting rather than later established standing', async () => {
  const result = await readRoundRatings(
    {
      listOfficialRatingLadders: officialRatingLadders,
      listLadderSeasons: async (lobbyId?: string) =>
        (
          [
            {
              id: seasonId,
              name: 'Season 1',
              startsAt: at,
              endsAt: null,
              status: 'active',
              lobbyId: 'youth',
              version: 1,
            },
            {
              id: 'o'.repeat(24),
              name: 'Open Season 1',
              startsAt: at,
              endsAt: null,
              status: 'active',
              lobbyId: 'open',
              version: 1,
            },
          ] as const
        ).filter((season) => season.lobbyId === lobbyId),
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
          side: p === aff ? ('affirmative' as const) : ('negative' as const),
          outcome: { kind: 'winner' as const, side: 'affirmative' },
        })),
      }),
    },
    {
      round: {
        ...asCompleted(view, { kind: 'winner', side: 'affirmative' }),
        ladder: youth,
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
  assert({
    given: 'a Youth Round beside an Open season running at the same time',
    should: 'name the Round’s own ladder and its division’s season',
    actual: [result?.ladder, result?.season],
    expected: [youth, 'Season 1'],
  });
});

test('a blinded debater hides the posting, and only both blinded hide that it rated', async () => {
  const read = (blinded: readonly string[]) =>
    readRoundRatings(
      {
        listOfficialRatingLadders: officialRatingLadders,
        listLadderSeasons: async (lobbyId?: string) =>
          (
            [
              {
                id: seasonId,
                name: 'Season 1',
                startsAt: at,
                endsAt: null,
                status: 'active',
                lobbyId: 'youth',
                version: 1,
              },
            ] as const
          ).filter((season) => season.lobbyId === lobbyId),
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
            side: p === aff ? ('affirmative' as const) : ('negative' as const),
            outcome: { kind: 'winner' as const, side: 'affirmative' },
          })),
        }),
      },
      {
        round: {
          ...asCompleted(view, { kind: 'winner', side: 'affirmative' }),
          ladder: youth,
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
        listOfficialRatingLadders: officialRatingLadders,
        listLadderSeasons: async (lobbyId?: string) =>
          (
            [
              {
                id: seasonId,
                name: 'Season',
                startsAt: at,
                endsAt: null,
                status: 'active',
                lobbyId: 'youth',
                version: 1,
              },
            ] as const
          ).filter((season) => season.lobbyId === lobbyId),
        readRatingBlindings: async () => [],
        readStandings: async () => ({ ratings: [], changes: [] }),
        readRatingFacts: async () =>
          awaits
            ? {
                competitionType: 'ranked',
                ladder: youth,
                status: 'completed',
                outcome: { kind: 'winner', side: 'affirmative' },
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
          ...asCompleted(view, { kind: 'winner', side: 'affirmative' }),
          ladder: youth,
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
