import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  NOW,
  activeSeason,
  closedSeason,
} from '../../../features/leaderboard/ladder.test-support';
import { SeasonCard } from './season-card';

setupRitewayBun();

describe('SeasonCard', () => {
  test('a live season', () => {
    const html = renderToString(
      h(SeasonCard, { season: activeSeason, now: NOW }),
    ).replace(/<!-- -->/g, '');
    assert({
      given: 'a live season',
      should: 'name it, say when it ends and link to seasons and the explainer',
      actual: [
        html.includes('This season'),
        html.includes('Season 5'),
        html.includes('Ends in 25 days.'),
        html.includes('href="/leaderboard/seasons"'),
        html.includes('href="/leaderboard/seasons#how-rating-works"'),
        html.includes('max-compact:hidden'),
      ],
      expected: [true, true, true, true, true, true],
    });
  });

  test('a closed season', () => {
    const html = renderToString(
      h(SeasonCard, { season: closedSeason, now: NOW }),
    );
    assert({
      given: 'a closed season',
      should: 'say final standings and fill the bar',
      actual: [
        html.includes('Final standings'),
        html.includes('value="27" max="27"'),
      ],
      expected: [true, true],
    });
  });
});
