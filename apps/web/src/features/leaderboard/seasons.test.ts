import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { NOW } from './ladder.test-support';
import { readLadder } from './read-leaderboard';
import { buildSeasonsView, parseSeasonsQuery, seasonsHref } from './seasons';

setupRitewayBun();

describe('parseSeasonsQuery', () => {
  test('season parameter', () => {
    assert({
      given: 'a valid, a missing, a bad and a repeated season',
      should: 'read the number or fall back to the current season',
      actual: [
        parseSeasonsQuery({ season: '3' }),
        parseSeasonsQuery({}),
        parseSeasonsQuery({ season: 'x' }),
        parseSeasonsQuery({ season: ['2', '3'] }),
        seasonsHref(3),
        seasonsHref(null),
      ],
      expected: [
        3,
        null,
        null,
        2,
        '/leaderboard/seasons?season=3',
        '/leaderboard/seasons',
      ],
    });
  });
});

describe('buildSeasonsView', () => {
  test('the live season', () => {
    const view = buildSeasonsView(readLadder(null, NOW, null).data, NOW);
    assert({
      given: 'the live season',
      should:
        'lead the snapshot, say how far along it is and mark the current chip',
      actual: [
        view.tag,
        view.championLabel,
        view.snapshotTitle,
        view.snapshot.length,
        view.champion?.username,
        view.statusLine,
        view.percent,
        view.chips.map((chip) => [chip.label, chip.selected]),
        view.ladderHref,
      ],
      expected: [
        'Current season',
        'Leading now',
        'Standings now',
        10,
        'debater-b',
        'Day 17 of 28',
        61,
        [
          ['Season 4 · current', true],
          ['Season 3', false],
          ['Season 2', false],
        ],
        '/leaderboard?season=4',
      ],
    });
  });

  test('a closed season', () => {
    const view = buildSeasonsView(readLadder(3, NOW, null).data, NOW);
    assert({
      given: 'a closed season',
      should: 'name the champion, freeze the standings and fill the bar',
      actual: [
        view.closed,
        view.championLabel,
        view.snapshotTitle,
        view.percent,
        view.snapshot[0]?.href,
      ],
      expected: [
        true,
        'Champion',
        'Final standings',
        100,
        '/leaderboard?season=3&debater=debater-b',
      ],
    });
  });

  test('no one established', () => {
    const data = readLadder(null, NOW, null).data;
    const view = buildSeasonsView({ ...data, entries: [] }, NOW);
    assert({
      given: 'a season with no entries',
      should: 'have no champion and an empty snapshot',
      actual: [view.champion, view.snapshot],
      expected: [null, []],
    });
  });
});
