import { createElement as h } from 'react';
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
import { renderAccessible } from '../../../test-support/rendered/accessible';

setupRitewayBun();

const empty = (props: Partial<EmptyLadderProps>) =>
  renderAccessible(
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
    const view = renderAccessible(
      h(LadderError, { retryHref: '/leaderboard?season=3' }),
    );
    assert({
      given: 'a ladder that failed to load',
      should: 'say so in plain words with a retry link that keeps the state',
      actual: [
        view
          .within('alert')
          .has('heading', 'The ladder could not load', { level: 2 }),
        view.within('alert').attribute('link', 'Try again', 'href'),
      ],
      expected: [true, '/leaderboard?season=3'],
    });
  });

  test('skeleton', () => {
    const view = renderAccessible(h(LadderSkeleton));
    assert({
      given: 'a loading ladder',
      should: 'announce itself as busy with seven placeholder rows',
      actual: [
        view.attribute('status', 'Loading the ladder', 'aria-busy'),
        view.get('status', 'Loading the ladder').children.length,
      ],
      expected: ['true', 7],
    });
  });
});

describe('notices', () => {
  test('judge', () => {
    assert({
      given: 'a judge',
      should: 'say ratings are hidden while judging',
      actual: renderAccessible(h(JudgeNotice)).text('note'),
      expected: 'Ratings are hidden while you judge.',
    });
  });

  test('live', () => {
    assert({
      given: 'no changes, one and three',
      should: 'render nothing, then a refresh link',
      actual: [0, 1, 3].map((changes) =>
        renderAccessible(
          h(LiveNotice, { changes, refreshHref: '/leaderboard' }),
        ).textContent(),
      ),
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
        renderAccessible(h(FinalBanner, { season: closedSeason }))
          .textContent()
          .includes('Season 4 is closed'),
        renderAccessible(
          h(EarlyBanner, {
            season: activeSeason,
            now: NOW,
            established: 6,
            provisional: 41,
          }),
        ).textContent(),
      ],
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
    const view = empty({});
    assert({
      given: 'filters that match nothing',
      should: 'offer Clear filters',
      actual: [
        view.textContent().includes('No matches'),
        view.attribute('link', 'Clear filters', 'href'),
      ],
      expected: [true, '/leaderboard'],
    });
  });

  test('provisional hits', () => {
    assert({
      given: 'one and two provisional matches',
      should: 'offer the wider list in the right number',
      actual: [1, 2].map((n) =>
        empty({ kind: 'provisional-hits', provisionalHits: n })
          .textContent()
          .includes(n === 1 ? '1 provisional match' : '2 provisional matches'),
      ),
      expected: [true, true],
    });
  });

  test('new season', () => {
    const view = empty({
      kind: 'new-season',
      previousSeasonHref: '/leaderboard?season=4',
      previousSeason: '4',
    });
    assert({
      given: 'a season nobody is ranked in',
      should: 'link to Everyone and the last final standings',
      actual: [
        view.has('heading', 'No one is ranked yet', { level: 2 }),
        view.attribute('link', 'Include new players', 'href'),
        view.attribute('link', 'See Season 4 final standings', 'href'),
      ],
      expected: [true, '/leaderboard?status=everyone', '/leaderboard?season=4'],
    });
  });

  test('hero and champion', () => {
    assert({
      given: 'a new season and last season’s champion',
      should: 'welcome with a Find a match link and name the champion',
      actual: [
        renderAccessible(
          h(NewSeasonHero, { season: activeSeason, now: NOW }),
        ).attribute('link', 'Find a match', 'href'),
        renderAccessible(
          h(PreviousChampion, {
            champion: { season: '4', username: 'ada', rating: 1758 },
          }),
        )
          .text('region', 'Last season’s champion')
          .includes('@ada'),
      ],
      expected: ['/ranked', true],
    });
  });
});

describe('error retry', () => {
  test('with a boundary retry', () => {
    const view = renderAccessible(
      h(LadderError, { retryHref: '/leaderboard', onRetry: () => undefined }),
    );
    assert({
      given: 'the error boundary’s retry',
      should: 'offer a button, not a link',
      actual: [view.has('button', 'Try again'), view.count('link')],
      expected: [true, 0],
    });
  });
});
