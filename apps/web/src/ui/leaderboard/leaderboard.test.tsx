import { ladderCopyInView } from '../test-support/ladder-copy.test-support';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { buildDetail } from '../../features/leaderboard/detail';
import { buildLadder } from '../../features/leaderboard/ladder';
import {
  NOW,
  dataFor,
  field,
  closedSeason,
} from '../../features/leaderboard/ladder.test-support';
import {
  defaultQuery,
  type LadderQuery,
} from '../../features/leaderboard/query';
import { entry } from '../../features/ratings/standing.test-support';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { Leaderboard } from './leaderboard';

setupRitewayBun();

const render = (
  entries: ReturnType<typeof field>,
  options: {
    query?: Partial<LadderQuery>;
    username?: string | null;
    season?: typeof closedSeason;
    judging?: boolean;
    ladder?: { style: 'freestyle'; division: 'open' | 'youth' };
    previousChampion?: {
      season: string;
      username: string;
      rating: number;
    } | null;
    pendingChanges?: number;
  } = {},
) => {
  const query = { ...defaultQuery, ...options.query };
  const username = options.username ?? null;
  const viewer = username
    ? { username, blinded: options.judging ? ['p001'] : [] }
    : null;
  const data = {
    ...dataFor(entries, options.season),
    previousChampion: options.previousChampion ?? null,
    pendingChanges: options.pendingChanges ?? 0,
  };
  const view = buildLadder(data, query, viewer);
  return renderAccessible(
    h(Leaderboard, {
      ladder: options.ladder ?? { style: 'freestyle', division: 'open' },
      view,
      query,
      now: NOW,
      judging: options.judging ?? false,
      detail: null,
    }),
  );
};

describe('Leaderboard', () => {
  test('a live season', () => {
    const view = render(field(40));
    const text = view.textContent();
    assert({
      given: 'a live season for a visitor',
      should: 'have one h1, say the season is live, filter and list',
      actual: [
        view.count('heading', undefined, { level: 1 }),
        text.includes('Season 5 is live. Ends in 25 days.'),
        view.has('search', 'Filter the ladder'),
        view.has('list', 'Top three'),
        view.has('region', 'Ladder'),
        view.has('link', 'How ratings work'),
        text.includes('Final'),
      ],
      expected: [1, true, true, true, true, true, false],
    });
  });

  test('a closed season', () => {
    const text = render(field(40), { season: closedSeason }).textContent();
    assert({
      given: 'a closed season',
      should: 'say final standings and show the Final banner',
      actual: [
        text.includes('Season 4 final standings'),
        text.includes('Season 4 is closed'),
        text.includes('is live'),
      ],
      expected: [true, true, false],
    });
  });

  test('a new season', () => {
    const view = render([entry({ id: 'p', played: 0, deviation: 200 })], {
      username: 'p',
      previousChampion: { season: '4', username: 'ada', rating: 1758 },
    });
    const text = view.textContent();
    assert({
      given: 'a season with nobody established',
      should:
        'welcome the season, say no one is ranked and name last season’s champion',
      actual: [
        text.includes('has started'),
        view.has('heading', 'No one is ranked yet', { level: 2 }),
        view.text('region', 'Last season’s champion').includes('@ada'),
        text.includes('This season'),
      ],
      expected: [true, true, true, false],
    });
  });

  test('the filters belong to the list, and no explainer cards lead', () => {
    const view = render(field(40));
    assert({
      given: 'a live season',
      should:
        'put the filters inside the ladder card, and show no season card or sample badge',
      actual: [
        view.within('region', 'Ladder').has('search', 'Filter the ladder'),
        view.textContent().includes('This season'),
        view.textContent().includes('Sample data'),
      ],
      expected: [true, false, false],
    });
  });

  test('no division is named above the table (YLeaderboard)', () => {
    const youth = render(field(40), {
      query: { division: 'youth' },
      ladder: { style: 'freestyle', division: 'youth' },
    });
    assert({
      given: 'the Youth ladder asked for',
      should:
        'name no ladder, style or division outside the lobby switch, and keep the Seasons link on the division',
      actual: [
        ladderCopyInView(youth),
        youth.textContent().includes('Members under 18'),
        youth
          .attribute('link', 'Seasons', 'href')
          ?.startsWith('/leaderboard/seasons?division=youth&season='),
      ],
      expected: [null, false, true],
    });
  });

  test('an early season', () => {
    const view = render(field(3));
    assert({
      given: 'three established debaters in a live season',
      should: 'count the established and provisional debaters',
      actual: view.textContent().includes('3 established, '),
      expected: true,
    });
  });

  test('a judge and a live update', () => {
    const view = render(field(40), {
      username: 'judge',
      judging: true,
      pendingChanges: 3,
    });
    assert({
      given: 'a judge and three changes waiting',
      should: 'explain the hidden ratings and offer a refresh',
      actual: [
        view.text('note'),
        view.has('link', '3 ranks changed. Refresh'),
        view.textContent().includes('Hidden'),
      ],
      expected: ['Ratings are hidden while you judge.', true, true],
    });
  });

  test('the detail', () => {
    const query = { ...defaultQuery, debater: 'p002' };
    const data = dataFor(field(40));
    const view = buildLadder(data, query, null);
    const detail = buildDetail(
      'p002',
      data.season,
      { seasonsPlayed: [], points: [] },
      query,
      null,
    );
    const rendered = renderAccessible(
      h(Leaderboard, {
        ladder: { style: 'freestyle', division: 'open' },
        view,
        query,
        now: NOW,
        judging: false,
        detail,
      }),
    );
    assert({
      given: 'an open debater',
      should: 'render the drawer beside the ladder',
      actual: rendered.has('complementary', 'Debater detail'),
      expected: true,
    });
  });
});
