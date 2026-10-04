import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  NOW,
  activeSeason,
  closedSeason,
} from '../../../features/leaderboard/ladder.test-support';
import {
  EarlyBanner,
  EmptyLadder,
  FinalBanner,
  JudgeNotice,
  LadderError,
  LadderSkeleton,
  LiveNotice,
  NewSeasonHero,
  PreviousChampion,
  seasonEnds,
  type EmptyLadderProps,
} from './ladder-states';

setupRitewayBun();

const empty = (props: Partial<EmptyLadderProps>) =>
  renderToString(
    h(EmptyLadder, {
      kind: 'filtered',
      provisionalHits: 0,
      clearHref: '/leaderboard',
      everyoneHref: '/leaderboard?status=everyone',
      previousSeasonHref: null,
      previousSeason: null,
      ...props,
    }),
  );

describe('error and loading', () => {
  test('error', () => {
    const html = renderToString(
      h(LadderError, { retryHref: '/leaderboard?season=3' }),
    );
    assert({
      given: 'a ladder that failed to load',
      should: 'say so in plain words with a retry link that keeps the state',
      actual: [
        html.includes('role="alert"'),
        html.includes('The ladder could not load'),
        html.includes('href="/leaderboard?season=3"'),
        html.includes('Try again'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('skeleton', () => {
    const html = renderToString(h(LadderSkeleton));
    assert({
      given: 'a loading ladder',
      should: 'announce itself as busy with seven placeholder rows',
      actual: [
        html.includes('aria-busy="true"'),
        html.includes('aria-label="Loading the ladder"'),
        html.match(/flex-1 rounded-sm/g)?.length,
      ],
      expected: [true, true, 7],
    });
  });
});

describe('notices', () => {
  test('judge', () => {
    assert({
      given: 'a judge',
      should: 'say ratings are hidden while judging',
      actual: renderToString(h(JudgeNotice)).includes(
        'Ratings are hidden while you judge.',
      ),
      expected: true,
    });
  });

  test('live', () => {
    assert({
      given: 'no changes, one and three',
      should: 'render nothing, then a refresh link',
      actual: [0, 1, 3]
        .map((changes) =>
          renderToString(
            h(LiveNotice, { changes, refreshHref: '/leaderboard' }),
          ).replace(/<!-- -->/g, ''),
        )
        .map((html) => html.replace(/<[^>]+>/g, '')),
      expected: [
        '',
        'Live1 rank changed. Refresh',
        'Live3 ranks changed. Refresh',
      ],
    });
  });

  test('final and early', () => {
    assert({
      given: 'a closed season and an early one',
      should: 'say so',
      actual: [
        renderToString(h(FinalBanner, { season: closedSeason })).includes(
          'Season 4 is closed',
        ),
        renderToString(
          h(EarlyBanner, {
            season: activeSeason,
            now: NOW,
            established: 6,
            provisional: 41,
          }),
        ).replace(/<!-- -->/g, ''),
      ].map((x) => (typeof x === 'string' ? x.replace(/<[^>]+>/g, '') : x)),
      expected: [true, 'Day 3 of Season 5 · 6 established, 41 provisional'],
    });
  });

  test('season ends', () => {
    assert({
      given: 'a live season on its third day',
      should: 'give its dates and days left',
      actual: seasonEnds(activeSeason, NOW),
      expected: '28 Sep 2026 to 26 Oct 2026. Ends in 25 days.',
    });
  });
});

describe('empty ladder', () => {
  test('filtered', () => {
    const html = empty({});
    assert({
      given: 'filters that match nothing',
      should: 'offer Clear filters',
      actual: [html.includes('No matches'), html.includes('Clear filters')],
      expected: [true, true],
    });
  });

  test('provisional hits', () => {
    assert({
      given: 'one and two provisional matches',
      should: 'offer the wider list in the right number',
      actual: [1, 2].map((n) =>
        empty({ kind: 'provisional-hits', provisionalHits: n })
          .replace(/<!-- -->/g, '')
          .includes(n === 1 ? '1 provisional match' : '2 provisional matches'),
      ),
      expected: [true, true],
    });
  });

  test('new season', () => {
    const html = empty({
      kind: 'new-season',
      previousSeasonHref: '/leaderboard?season=4',
      previousSeason: 4,
    }).replace(/<!-- -->/g, '');
    assert({
      given: 'a season nobody is ranked in',
      should: 'link to Everyone and the last final standings',
      actual: [
        html.includes('No one is ranked yet'),
        html.includes('href="/leaderboard?status=everyone"'),
        html.includes('See Season 4 final standings'),
      ],
      expected: [true, true, true],
    });
  });

  test('hero and champion', () => {
    assert({
      given: 'a new season and last season’s champion',
      should: 'welcome with a Find a match link and name the champion',
      actual: [
        renderToString(
          h(NewSeasonHero, { season: activeSeason, now: NOW }),
        ).includes('href="/ranked"'),
        renderToString(
          h(PreviousChampion, {
            champion: { season: 4, username: 'ada', rating: 1758 },
          }),
        ).includes('@ada'),
      ],
      expected: [true, true],
    });
  });
});

describe('error retry', () => {
  test('with a boundary retry', () => {
    const html = renderToString(
      h(LadderError, { retryHref: '/leaderboard', onRetry: () => undefined }),
    );
    assert({
      given: 'the error boundary’s retry',
      should: 'offer a button, not a link',
      actual: [html.includes('<button'), html.includes('<a ')],
      expected: [true, false],
    });
  });
});
