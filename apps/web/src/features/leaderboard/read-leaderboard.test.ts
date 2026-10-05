import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { buildLadder } from './ladder';
import { NOW } from './ladder.test-support';
import { defaultQuery } from './query';
import { readDebater, readLadder } from './read-leaderboard';

setupRitewayBun();

describe('readLadder', () => {
  test('the current season for a visitor', () => {
    const { data, viewer } = readLadder(null, NOW, null);
    const view = buildLadder(data, defaultQuery, viewer);
    assert({
      given: 'no season and no signed-in viewer',
      should: 'read the live season’s 240 debaters with the deleted one ranked',
      actual: [
        data.season.id,
        data.seasons.map((season) => season.status),
        data.entries.length,
        viewer,
        view.podium.map((row) => row.username),
        view.pendingChanges,
      ],
      expected: [
        4,
        ['active', 'closed', 'closed'],
        240,
        null,
        ['debater-b', 'debater-c', 'debater-d'],
        0,
      ],
    });
  });

  test('a closed season and the viewer', () => {
    const { data, viewer } = readLadder(3, NOW, 'sam');
    const view = buildLadder(data, defaultQuery, viewer);
    assert({
      given: 'season three and a signed-in viewer',
      should:
        'give the viewer a standing and name the season before’s champion',
      actual: [data.season.id, view.hasStanding, data.previousChampion],
      expected: [3, true, { season: 2, username: 'debater-b', rating: 1721 }],
    });
  });

  test('an unknown season', () => {
    assert({
      given: 'a season that does not exist',
      should: 'read the current season',
      actual: readLadder(99, NOW, null).data.season.id,
      expected: 4,
    });
  });

  test('the oldest season has no champion before it', () => {
    assert({
      given: 'season two',
      should: 'have no previous champion',
      actual: readLadder(2, NOW, null).data.previousChampion,
      expected: null,
    });
  });
});

describe('readDebater', () => {
  test('a history and the seasons played', () => {
    const { points, seasonsPlayed } = readDebater('debater-b', 4, NOW, null);
    assert({
      given: 'a top debater',
      should: 'start the series at the season start and end at their rating',
      actual: [
        points[0],
        points.length > 10,
        points.at(-1)?.rating,
        seasonsPlayed.map((played) => played.entry?.rank),
      ],
      expected: [
        { game: 0, rating: 1500, deviation: 350, result: null, opponent: null },
        true,
        1716,
        [1, 1, 1],
      ],
    });
  });

  test('a debater who did not play', () => {
    const { points, seasonsPlayed } = readDebater('sam', 2, NOW, 'sam');
    assert({
      given: 'the viewer in a season before their first debate',
      should: 'have no history and no line in it',
      actual: [
        points,
        seasonsPlayed.map((played) => played.entry?.provisional ?? null),
      ],
      expected: [[], [true, false, null]],
    });
  });
});
