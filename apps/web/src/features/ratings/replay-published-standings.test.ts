import { rateDebate, ratingPolicy } from '@daisy/debate-engine';
import { winnerOutcome } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { replayPublishedStandings } from './replay-published-standings';

setupRitewayBun();

test('both competitors progress after a hidden game using only public results', () => {
  const seasonId = 'season';
  const at = '2026-11-21T12:00:00.000Z';
  const publicGame = {
    seasonId,
    roundId: 'published',
    occurredAt: at,
    outcome: winnerOutcome('affirmative'),
  };
  const rooms = [
    { ...publicGame, actorId: 'ada', side: 'affirmative' },
    { ...publicGame, actorId: 'ben', side: 'negative' },
  ];
  const people = ['ada', 'ben'].map((actorId) => ({
    actorId,
    username: actorId,
    accountClosed: false,
  }));
  const read = replayPublishedStandings({
    ratings: [
      { ...people[1]!, ...ratingPolicy.initial, seasonId, rating: 1300 },
    ],
    changes: [
      {
        ...rooms[1]!,
        ratingBefore: 1500,
        ratingAfter: 1300,
        deviationBefore: 350,
        deviationAfter: 300,
      },
    ],
    publicResults: { replaySeasonIds: [seasonId], people, rooms },
  });
  const first = { state: ratingPolicy.initial, lastRatedAt: null };
  const expected = rateDebate({
    affirmative: first,
    negative: first,
    occurredAt: at,
    outcome: publicGame.outcome,
  });
  assert({
    given:
      'Ada’s private result preceded a public match against Ben and their stored ratings reflect both games',
    should:
      'publish both competitors from their public match alone and exclude the private history from their movement',
    actual: {
      ratings: read.ratings.map(({ actorId, rating }) => [actorId, rating]),
      changes: read.changes.map(({ actorId, roundId, ratingBefore }) => [
        actorId,
        roundId,
        ratingBefore,
      ]),
    },
    expected: {
      ratings: [
        ['ada', expected.affirmative.after.rating],
        ['ben', expected.negative.after.rating],
      ],
      changes: [
        ['ada', 'published', 1500],
        ['ben', 'published', 1500],
      ],
    },
  });
});
