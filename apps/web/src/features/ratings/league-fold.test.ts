import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { rateDebate, ratingPolicy } from '@daisy/debate-engine';
import { foldLeagueRatings } from './league-fold';
setupRitewayBun();
const at = '2027-01-01T00:00:00.000Z';
const game = {
  result: 'r1',
  source: 'tournament' as const,
  playedAt: at,
  sides: [['a'], ['b']] as const,
  winner: 0 as const,
};
describe('foldLeagueRatings', () => {
  test('reuses the canonical rating period and ignores duplicate input', () => {
    const expected = rateDebate({
      affirmative: { state: ratingPolicy.initial, lastRatedAt: null },
      negative: { state: ratingPolicy.initial, lastRatedAt: null },
      outcome: { kind: 'winner', side: 'affirmative' },
      occurredAt: at,
    });
    const actual = foldLeagueRatings([game, game]);
    assert({
      given: 'one decided game delivered twice',
      should: 'rate each participant exactly once with canonical Glicko',
      actual: actual.map((row) => ({
        actorId: row.actorId,
        state: row.state,
        games: row.games,
        wins: row.wins,
      })),
      expected: [
        { actorId: 'a', state: expected.affirmative.after, games: 1, wins: 1 },
        { actorId: 'b', state: expected.negative.after, games: 1, wins: 0 },
      ],
    });
  });
  test('keeps Room and tournament result identities separate', () => {
    assert({
      given:
        'a Room and a tournament result sharing an identifier in different tables',
      should: 'count both distinct competitive occurrences',
      actual: foldLeagueRatings([game, { ...game, source: 'league_room' }]).map(
        (row) => row.games,
      ),
      expected: [2, 2],
    });
  });
  test('does not invent a result for empty or overlapping sides', () => {
    assert({
      given: 'invalid participant membership',
      should: 'leave the ladder empty',
      actual: foldLeagueRatings([
        { ...game, sides: [[], ['b']] },
        { ...game, sides: [['a'], ['a']] },
      ]),
      expected: [],
    });
  });
});

describe('league team rating updates', () => {
  test('rates each teammate once against the opposing pre-game average', () => {
    const actual = foldLeagueRatings([
      {
        ...game,
        sides: [
          ['a', 'c'],
          ['b', 'd'],
        ],
      },
    ]);
    const singleton = foldLeagueRatings([game]);
    assert({
      given: 'two teams of newcomers',
      should:
        'apply singleton-equivalent win and loss updates to all four members',
      actual: actual.map((row) => [row.actorId, row.state, row.games]),
      expected: [
        ['a', singleton[0]!.state, 1],
        ['c', singleton[0]!.state, 1],
        ['b', singleton[1]!.state, 1],
        ['d', singleton[1]!.state, 1],
      ],
    });
  });
  test('replays chronological games deterministically with idle time', () => {
    const later = {
      ...game,
      result: 'r2',
      playedAt: '2027-02-01T00:00:00.000Z',
      winner: 1 as const,
    };
    const first = foldLeagueRatings([game]);
    const expected = rateDebate({
      affirmative: first[0]!,
      negative: first[1]!,
      outcome: { kind: 'winner', side: 'negative' },
      occurredAt: later.playedAt,
    });
    assert({
      given: 'a second decisive game after a month idle',
      should: 'reuse canonical inactivity widening and prior state',
      actual: foldLeagueRatings([game, later])[0]!.state,
      expected: expected.affirmative.after,
    });
  });
});

describe('mixed-experience teams', () => {
  test('uses the same pre-game opponents for every teammate', () => {
    const first = foldLeagueRatings([game]);
    const playedAt = '2027-02-01T00:00:00.000Z';
    const newcomer = { state: ratingPolicy.initial, lastRatedAt: null };
    const againstSolo = rateDebate({
      affirmative: newcomer,
      negative: first[1]!,
      outcome: { kind: 'winner', side: 'affirmative' },
      occurredAt: playedAt,
    });
    const actual = foldLeagueRatings([
      game,
      {
        ...game,
        result: 'r2',
        playedAt,
        sides: [['a', 'c'], ['b']],
      },
    ]);
    assert({
      given: 'a newcomer joining an experienced debater against one opponent',
      should: 'rate the newcomer against the solo opponent’s pre-game state',
      actual: actual.find(({ actorId }) => actorId === 'c')?.state,
      expected: againstSolo.affirmative.after,
    });
  });
});
