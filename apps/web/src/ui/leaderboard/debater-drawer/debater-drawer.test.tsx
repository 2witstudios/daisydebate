import { createElement as h } from 'react';
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
} from '../../../features/leaderboard/read-leaderboard.test-support';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { DebaterDrawer } from './debater-drawer';

setupRitewayBun();

const render = (
  username: string,
  seasonId: string,
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
  return renderAccessible(h(DebaterDrawer, { detail, query }));
};

describe('DebaterDrawer', () => {
  test('an established debater', () => {
    const view = render('debater-b', '4', null);
    const text = view.textContent();
    assert({
      given: 'the top debater with the chart view',
      should:
        'show stats, chart with the table link, recent results, seasons and the profile link',
      actual: [
        view.has('complementary', 'Debater detail'),
        view.has('heading', '@debater-b', { level: 2 }),
        text.includes('#1'),
        text.includes('Established'),
        view.names('img'),
        view
          .within('navigation', 'Chart or table')
          .attribute('link', 'Table', 'href'),
        view.has('heading', 'Recent results', { level: 3 }),
        text.match(/Debate \d+/g)?.length,
        view.has('heading', 'Seasons played', { level: 3 }),
        text.includes('Did not play'),
        view.attribute('link', 'View full profile', 'href'),
        view
          .all('link', 'Close detail')
          .map((link) => link.getAttribute('href')),
      ],
      expected: [
        true,
        true,
        true,
        true,
        [
          'Rating history, Season 4. Started at 1500, now 1716 after 49 ranked debates.',
        ],
        '/leaderboard?season=4&debater=debater-b&view=table',
        true,
        6,
        true,
        false,
        '/profile/debater-b',
        ['/leaderboard?season=4', '/leaderboard?season=4'],
      ],
    });
  });

  test('the table alternative', () => {
    const view = render(
      'sam',
      '4',
      { username: 'sam', blinded: [] },
      { view: 'table' },
    );
    const text = view.textContent();
    assert({
      given: 'the viewer’s provisional detail on the table view',
      should:
        'list all seven debates in a captioned table instead of the chart',
      actual: [
        view.has('table', 'Every ranked debate, newest first'),
        // A header row, then one row per debate.
        view.within('table', 'Every ranked debate, newest first').count('row') -
          1,
        view.count('img'),
        text.includes('Provisional'),
        view.get('heading', '@sam', { level: 2 }).nextElementSibling
          ?.textContent,
        text.includes('Did not play') || text.includes('Season 2'),
      ],
      expected: [true, 7, 0, true, 'You', true],
    });
  });

  test('no ranked debates', () => {
    const view = render('sam', '2', { username: 'sam', blinded: [] });
    assert({
      given: 'a season before the viewer’s first debate',
      should: 'say so',
      actual: [
        view.textContent().includes('You have no ranked debates in Season 2.'),
        view.count('img'),
      ],
      expected: [true, 0],
    });
  });

  test('a debater being judged', () => {
    const view = render('debater-b', '4', {
      username: 'sam',
      blinded: ['debater-b'],
    });
    const text = view.textContent();
    assert({
      given: 'a judge assigned to the debater',
      should: 'say hidden and show no number of theirs',
      actual: [
        text.includes('Hidden while you judge'),
        text.includes('1716'),
        view.count('img'),
      ],
      expected: [true, false, 0],
    });
  });

  test('close targets', () => {
    const view = render('debater-b', '4', null);
    assert({
      given: 'the open detail',
      should: 'close from the button and from the scrim, both plain links',
      actual: view.count('link', 'Close detail'),
      expected: 2,
    });
  });
});
