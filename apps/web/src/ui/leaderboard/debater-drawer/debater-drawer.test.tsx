import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { buildDetail } from '../../../features/leaderboard/detail';
import { NOW } from '../../../features/leaderboard/ladder.test-support';
import {
  defaultQuery,
  type LadderQuery,
} from '../../../features/leaderboard/query';
import {
  readDebater,
  readLadder,
} from '../../../features/leaderboard/read-leaderboard';
import { DebaterDrawer } from './debater-drawer';

setupRitewayBun();

const render = (
  username: string,
  seasonId: number,
  viewer: { username: string; blinded: readonly string[] } | null,
  overrides: Partial<LadderQuery> = {},
) => {
  const query = {
    ...defaultQuery,
    season: seasonId,
    debater: username,
    ...overrides,
  };
  const season = readLadder(seasonId, NOW, viewer?.username ?? null).data
    .season;
  const detail = buildDetail(
    username,
    season,
    readDebater(username, seasonId, NOW, viewer?.username ?? null),
    query,
    viewer,
  );
  return renderToString(h(DebaterDrawer, { detail, query })).replace(
    /<!-- -->/g,
    '',
  );
};

describe('DebaterDrawer', () => {
  test('an established debater', () => {
    const html = render('debater-b', 4, null);
    assert({
      given: 'the top debater with the chart view',
      should:
        'show stats, chart with the table link, recent results, seasons and the profile link',
      actual: [
        html.includes('aria-label="Debater detail"'),
        html.includes('@debater-b'),
        html.includes('#1'),
        html.includes('Established'),
        html.includes('role="img"'),
        html.includes(
          'href="/leaderboard?season=4&amp;debater=debater-b&amp;view=table"',
        ),
        html.includes('Recent results'),
        html.match(/Debate \d+/g)?.length,
        html.includes('Seasons played'),
        html.includes('Did not play'),
        html.includes('href="/profile/debater-b"'),
        html.includes('href="/leaderboard?season=4"'),
      ],
      expected: [
        true,
        true,
        true,
        true,
        true,
        true,
        true,
        6,
        true,
        false,
        true,
        true,
      ],
    });
  });

  test('the table alternative', () => {
    const html = render(
      'sam',
      4,
      { username: 'sam', blinded: [] },
      { view: 'table' },
    );
    assert({
      given: 'the viewer’s provisional detail on the table view',
      should:
        'list all seven debates in a captioned table instead of the chart',
      actual: [
        html.includes('<table'),
        html.includes('Every ranked debate, newest first'),
        html.match(/<tr /g)?.length,
        html.includes('role="img"'),
        html.includes('Provisional'),
        html.includes('>You<'),
        html.includes('Did not play') || html.includes('Season 2'),
      ],
      expected: [true, true, 7, false, true, true, true],
    });
  });

  test('no ranked debates', () => {
    const html = render('sam', 2, { username: 'sam', blinded: [] });
    assert({
      given: 'a season before the viewer’s first debate',
      should: 'say so',
      actual: [
        html.includes('You have no ranked debates in Season 2.'),
        html.includes('role="img"'),
      ],
      expected: [true, false],
    });
  });

  test('a debater being judged', () => {
    const html = render('debater-b', 4, {
      username: 'sam',
      blinded: ['debater-b'],
    });
    assert({
      given: 'a judge assigned to the debater',
      should: 'say hidden and show no number of theirs',
      actual: [
        html.includes('Hidden while you judge'),
        html.includes('1716'),
        html.includes('role="img"'),
      ],
      expected: [true, false, false],
    });
  });

  test('close targets', () => {
    const html = render('debater-b', 4, null);
    assert({
      given: 'the open detail',
      should: 'close from the button and from the scrim, both plain links',
      actual: html.match(/aria-label="Close detail"/g)?.length,
      expected: 2,
    });
  });
});
