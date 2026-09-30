import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
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
import { entry } from '../../features/leaderboard/standing.test-support';
import { Leaderboard } from './leaderboard';

setupRitewayBun();

const render = (
  entries: ReturnType<typeof field>,
  options: {
    query?: Partial<LadderQuery>;
    username?: string | null;
    season?: typeof closedSeason;
    judging?: boolean;
    previousChampion?: {
      season: number;
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
  return renderToString(
    h(Leaderboard, {
      view,
      query,
      now: NOW,
      username,
      judging: options.judging ?? false,
      detail: null,
    }),
  ).replace(/<!-- -->/g, '');
};

describe('Leaderboard', () => {
  test('a live season', () => {
    const html = render(field(40));
    assert({
      given: 'a live season for a visitor',
      should:
        'have one h1, say the season is live, filter, list and invite sign-in',
      actual: [
        html.match(/<h1/g)?.length,
        html.includes(
          'Season 5 is live. Ratings update after every ranked debate.',
        ),
        html.includes('role="search"'),
        html.includes('aria-label="Top three"'),
        html.includes('aria-label="Ladder"'),
        html.includes('Sign in'),
        html.includes('Sample data'),
        html.includes('Final'),
      ],
      expected: [1, true, true, true, true, true, true, false],
    });
  });

  test('a closed season', () => {
    const html = render(field(40), { season: closedSeason });
    assert({
      given: 'a closed season',
      should: 'say final standings and show the Final banner',
      actual: [
        html.includes('Season 4 final standings'),
        html.includes('These standings will not change.'),
        html.includes('is live'),
      ],
      expected: [true, true, false],
    });
  });

  test('a new season', () => {
    const html = render([entry({ id: 'p', played: 0 })], {
      username: 'p',
      previousChampion: { season: 4, username: 'ada', rating: 1758 },
    });
    assert({
      given: 'a season with nobody established',
      should:
        'welcome the season, say no one is ranked and name last season’s champion, without the season card',
      actual: [
        html.includes('has started'),
        html.includes('No one is ranked yet'),
        html.includes('@ada'),
        html.includes('How ratings work'),
      ],
      expected: [true, true, true, false],
    });
  });

  test('an early season', () => {
    const html = render(field(3));
    assert({
      given: 'three established debaters in a live season',
      should: 'explain that everyone is showing',
      actual: html.includes('Showing everyone.'),
      expected: true,
    });
  });

  test('a judge and a live update', () => {
    const html = render(field(40), {
      username: 'judge',
      judging: true,
      pendingChanges: 3,
    });
    assert({
      given: 'a judge and three changes waiting',
      should: 'explain the hidden ratings and offer a refresh',
      actual: [
        html.includes('Ratings are hidden while you judge.'),
        html.includes('3 ranks changed. Refresh'),
        html.includes('Hidden'),
      ],
      expected: [true, true, true],
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
    const html = renderToString(
      h(Leaderboard, {
        view,
        query,
        now: NOW,
        username: null,
        judging: false,
        detail,
      }),
    );
    assert({
      given: 'an open debater',
      should: 'render the drawer beside the ladder',
      actual: html.includes('aria-label="Debater detail"'),
      expected: true,
    });
  });
});
