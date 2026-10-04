import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { entry } from '../../../features/leaderboard/standing.test-support';
import { defaultQuery } from '../../../features/leaderboard/query';
import {
  closedSeason,
  field,
  ladder,
} from '../../../features/leaderboard/ladder.test-support';
import { YouBar } from './you-bar';

setupRitewayBun();

const viewer = { username: 'me', blinded: [] };
const me = entry({ id: 'me', username: 'me', rating: 1300 });
const bar = (
  entries: ReturnType<typeof field>,
  options: {
    signedIn?: boolean;
    season?: typeof closedSeason;
    scope?: 'top' | 'around';
  } = {},
) => {
  const query = { ...defaultQuery, scope: options.scope ?? 'top' };
  const view = ladder(
    entries,
    query,
    options.signedIn === false ? null : viewer,
    options.season,
  );
  return renderToString(
    h(YouBar, {
      view,
      query,
      username: options.signedIn === false ? null : 'me',
    }),
  ).replace(/<!-- -->/g, '');
};

describe('YouBar', () => {
  test('signed out', () => {
    const html = bar(field(12), { signedIn: false });
    assert({
      given: 'a visitor',
      should: 'invite them to sign in and come back to this ladder',
      actual: [
        html.includes('See where you rank'),
        html.includes('href="/sign-in?next=%2Fleaderboard"'),
        html.includes('aria-label="Your standing"'),
      ],
      expected: [true, true, true],
    });
  });

  test('no ranked debates', () => {
    assert({
      given: 'a live season and a closed one, with no line for the viewer',
      should: 'offer Find a match only while the season is live',
      actual: [
        bar(field(12)).includes('href="/ranked"'),
        bar(field(12), { season: closedSeason }).includes('href="/ranked"'),
        bar(field(12)).includes('You have no ranked debates in this season.'),
      ],
      expected: [true, false, true],
    });
  });

  test('established', () => {
    const html = bar([...field(30), me]);
    assert({
      given: 'an established viewer',
      should: 'pin rank, band, record and the two links',
      actual: [
        html.includes('#31'),
        html.includes('@me'),
        html.includes('Bud · 10–10 W–L'),
        html.includes('Show around me'),
        html.includes('Jump to my rank'),
        html.includes('href="/leaderboard?page=3"'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('around me toggles to the top', () => {
    const html = bar([...field(30), me], { scope: 'around' });
    assert({
      given: 'the around-me window',
      should: 'offer Show the top',
      actual: html.includes('Show the top'),
      expected: true,
    });
  });

  test('provisional', () => {
    const html = bar([...field(30), { ...me, played: 7 }]);
    assert({
      given: 'a viewer with seven of ten ranked debates',
      should: 'show the progress and how many more place them',
      actual: [
        html.includes('You are provisional'),
        html.includes('<progress value="7" max="10"'),
        html.includes('3 more to place you.'),
        html.includes('href="/ranked"'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('a closed season', () => {
    const html = bar([...field(30), me], { season: closedSeason });
    assert({
      given: 'a closed season',
      should: 'label the pinned line Final',
      actual: html.includes('Final · Bud'),
      expected: true,
    });
  });
});
