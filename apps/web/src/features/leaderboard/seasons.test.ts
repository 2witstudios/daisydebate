import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { NOW } from './ladder.test-support';
import { readLadder as readStoredLadder } from './read-leaderboard';
import { readLadder } from './read-leaderboard.test-support';
import {
  buildSeasonsView,
  listsPublishedResolutions,
  parseSeasonsQuery,
  seasonsHref,
} from './seasons';

setupRitewayBun();

describe('parseSeasonsQuery', () => {
  test('season parameter', () => {
    assert({
      given: 'a valid, a missing, a bad and a repeated season',
      should: 'read the number or fall back to the current season',
      actual: [
        parseSeasonsQuery({ season: 'ssssssssssssssssssssssss' }),
        parseSeasonsQuery({}),
        parseSeasonsQuery({ season: 'x' }),
        parseSeasonsQuery({ season: ['tttttttttttttttttttttttt', '3'] }),
        seasonsHref('3'),
        seasonsHref(null),
      ],
      expected: [
        'ssssssssssssssssssssssss',
        null,
        null,
        'tttttttttttttttttttttttt',
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
    const view = buildSeasonsView(readLadder('3', NOW, null).data, NOW);
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

describe('when the current resolutions show', () => {
  test('a running season, and a closed one picked while another runs', () => {
    const view = (season: string | null) =>
      buildSeasonsView(readLadder(season, NOW, null).data, NOW);
    assert({
      given: 'the running season, then a closed one with another running',
      should: 'list them for the running season only',
      actual: [null, '3'].map((season) => [
        view(season).state,
        listsPublishedResolutions(view(season)),
      ]),
      expected: [
        ['running', true],
        ['past', false],
      ],
    });
  });

  test('no active season, read through the standings fallback', async () => {
    const read = await readStoredLadder(
      {
        readRatingBlindings: async () => [],
        listLadderSeasons: async () => [
          {
            id: 'k2v9x0f4m8q3w1z7c5n6b4d2',
            name: 'Season 1',
            startsAt: '2026-09-01T00:00:00.000Z',
            endsAt: '2026-10-01T00:00:00.000Z',
            status: 'closed',
            version: 2,
          },
        ],
        readStandings: async () => ({ ratings: [], changes: [] }),
      },
      { seasonId: null, ladder: 'value', now: NOW, username: null },
    );
    const view = buildSeasonsView(read!.data, NOW);
    assert({
      given: 'only a closed season, which the read falls back to',
      should: 'mark that none is active and list them',
      actual: [view.state, listsPublishedResolutions(view)],
      expected: ['none-active', true],
    });
  });
});

test('season navigation preserves the selected independent ladder', () => {
  const data = readLadder(null, NOW, null).data;
  const view = buildSeasonsView(data, NOW, null, 'policy');
  assert({
    given: 'a Policy season overview',
    should: 'label the ladder and preserve it in chips, detail and return URLs',
    actual: [
      view.ladderLabel,
      view.chips.every((c) => c.href.includes('ladder=policy')),
      view.ladderHref.includes('ladder=policy'),
      view.snapshot.every((r) => r.href.includes('ladder=policy')),
    ],
    expected: ['Policy', true, true, true],
  });
});
