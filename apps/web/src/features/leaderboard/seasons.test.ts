import { officialRatingLadders } from '../ratings/standing.test-support';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { NOW } from './ladder.test-support';
import { readLadder as readStoredLadder } from './read-leaderboard';
import { readLadder } from './read-leaderboard.test-support';
import { buildSeasonsView, parseSeasonsQuery, seasonsHref } from './seasons';

const open = { style: 'freestyle', division: 'open' } as const;
const youth = { style: 'freestyle', division: 'youth' } as const;

setupRitewayBun();

describe('parseSeasonsQuery', () => {
  test('season parameter', () => {
    assert({
      given: 'a valid, a missing, a bad and a repeated season',
      should:
        'read the number or fall back to the current season, and link a division',
      actual: [
        parseSeasonsQuery({ season: 'ssssssssssssssssssssssss' }),
        parseSeasonsQuery({}),
        parseSeasonsQuery({ season: 'x' }),
        parseSeasonsQuery({ season: ['tttttttttttttttttttttttt', '3'] }),
        seasonsHref('3', null),
        seasonsHref(null, null),
        seasonsHref('3', 'youth'),
      ],
      expected: [
        'ssssssssssssssssssssssss',
        null,
        null,
        'tttttttttttttttttttttttt',
        '/leaderboard/seasons?season=3',
        '/leaderboard/seasons',
        '/leaderboard/seasons?division=youth&season=3',
      ],
    });
  });
});

describe('buildSeasonsView', () => {
  test('the live season', () => {
    const view = buildSeasonsView(readLadder(null, NOW, null).data, open, NOW);
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
        '/leaderboard?division=open&season=4',
      ],
    });
  });

  test('a closed season', () => {
    const view = buildSeasonsView(readLadder('3', NOW, null).data, open, NOW);
    assert({
      given: 'a closed season',
      should: 'name the champion, freeze the standings and fill the bar',
      actual: [
        view.state,
        view.championLabel,
        view.snapshotTitle,
        view.percent,
        view.snapshot[0]?.href,
      ],
      expected: [
        'past',
        'Champion',
        'Final standings',
        100,
        '/leaderboard?division=open&season=3&debater=debater-b',
      ],
    });
  });

  test('no one established', () => {
    const data = readLadder(null, NOW, null).data;
    const view = buildSeasonsView({ ...data, entries: [] }, open, NOW);
    assert({
      given: 'a season with no entries',
      should: 'have no champion and an empty snapshot',
      actual: [view.champion, view.snapshot],
      expected: [null, []],
    });
  });
});

describe('a season with none active', () => {
  test('read through the standings fallback', async () => {
    const read = await readStoredLadder(
      {
        readRatingBlindings: async () => [],
        listOfficialRatingLadders: officialRatingLadders,
        listLadderSeasons: async () => [
          {
            id: 'k2v9x0f4m8q3w1z7c5n6b4d2',
            name: 'Season 1',
            startsAt: '2026-09-01T00:00:00.000Z',
            endsAt: '2026-10-01T00:00:00.000Z',
            status: 'closed',
            lobbyId: 'open',
            version: 2,
          },
        ],
        readStandings: async () => ({ ratings: [], changes: [] }),
      },
      { seasonId: null, ladder: open, now: NOW, username: null },
    );
    const view = buildSeasonsView(read!.data, open, NOW);
    assert({
      given: 'only a closed season, which the read falls back to',
      should: 'mark that none is active',
      actual: view.state,
      expected: 'none-active',
    });
  });
});

test('the overview names no ladder and keeps every link on its division', () => {
  const view = buildSeasonsView(readLadder(null, NOW, null).data, youth, NOW);
  assert({
    given: 'a season overview of the Youth ladder',
    should: 'name no ladder, and keep every link on the Youth division',
    actual: [
      'ladderLabel' in view,
      [...view.chips.map((c) => c.href), view.ladderHref].every((href) =>
        href.includes('division=youth'),
      ),
    ],
    expected: [false, true],
  });
});
