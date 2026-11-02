import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { NOW } from '../../../features/leaderboard/ladder.test-support';
import { readLadder } from '../../../features/leaderboard/read-leaderboard.test-support';
import {
  buildSeasonsView,
  listsPublishedResolutions,
} from '../../../features/leaderboard/seasons';
import { SeasonsPage } from './seasons-page';

setupRitewayBun();

const resolutions = [
  {
    id: 'pryied8jvkvrn7g0p60iv632',
    kind: 'policy',
    text: 'Resolved: Test wording.',
    provenance: 'Test publication',
    publishedAt: '2026-10-29T00:00:00.000Z',
    edition: null,
    theme: null,
  },
] as const;

const render = (season: string | null, entries?: 'none') => {
  const data = readLadder(season, NOW, null).data;
  const view = buildSeasonsView(entries ? { ...data, entries: [] } : data, NOW);
  return renderToString(
    h(SeasonsPage, {
      view,
      resolutions: listsPublishedResolutions(view) ? resolutions : [],
    }),
  ).replace(/<!-- -->/g, '');
};

describe('SeasonsPage', () => {
  test('the live season', () => {
    const html = render(null);
    assert({
      given: 'the live season',
      should:
        'show one h1, season chips as links, the leader, ten rows and the explainer anchor',
      actual: [
        html.match(/<h1/g)?.length,
        html.includes('href="/leaderboard/seasons?season=3"'),
        html.includes('Leading now'),
        html.includes('Standings now'),
        html.match(/<li class="border-t/g)?.length,
        html.includes('id="how-rating-works"'),
        html.includes('Provisional while rating deviation is above 110.'),
        html.includes('Current season'),
        html.match(/href="\/leaderboard\?season=4"/g)?.length,
        html.includes('Resolved: Test wording.'),
      ],
      expected: [1, true, true, true, 10, true, true, true, 2, true],
    });
  });

  test('a closed season', () => {
    const html = render('3');
    assert({
      given: 'a closed season',
      should:
        'name the champion, label the standings final and show the season change column',
      actual: [
        html.includes('Champion'),
        html.includes('Final standings'),
        html.includes('>Season<'),
        html.includes('value="100"'),
        html.includes('aria-current="page"'),
        html.includes('Resolved: Test wording.'),
      ],
      expected: [true, true, true, true, true, false],
    });
    assert({
      given: 'the closed season champion',
      should: 'give only the rating and the W–L record, with no tier',
      actual: /<span[^>]*>\d+ · \d+–\d+ W–L<\/span>/.test(html),
      expected: true,
    });
  });

  test('the range picture', () => {
    const html = render(null);
    assert({
      given: 'the explainer',
      should: 'draw a labelled picture of a wide and a narrow range',
      actual: [
        html.includes('role="img"'),
        html.includes('Provisional'),
        html.includes('Hollow marker: provisional.'),
      ],
      expected: [true, true, true],
    });
  });

  test('no active season', () => {
    const html = renderToString(
      h(SeasonsPage, { view: null, resolutions }),
    ).replace(/<!-- -->/g, '');
    assert({
      given: 'no active season',
      should: 'say so, list the current resolutions and keep the page frame',
      actual: [
        html.includes('No season is active.'),
        html.includes('Resolved: Test wording.'),
        html.includes('max-w-dash-column'),
        html.includes('font-display'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('a closed season with no active one', () => {
    const data = readLadder('3', NOW, null).data;
    const view = buildSeasonsView(
      { ...data, seasons: data.seasons.filter(({ id }) => id !== '4') },
      NOW,
    );
    const html = renderToString(h(SeasonsPage, { view, resolutions })).replace(
      /<!-- -->/g,
      '',
    );
    assert({
      given: 'only closed seasons',
      should: 'say none is active and list the resolutions before that season',
      actual: [
        html.includes('No season is active.'),
        html.indexOf('Resolved: Test wording.') > -1 &&
          html.indexOf('Resolved: Test wording.') <
            html.indexOf('Final standings'),
      ],
      expected: [true, true],
    });
  });

  test('no one established', () => {
    const html = render(null, 'none');
    assert({
      given: 'a season with no one established',
      should: 'still render without a champion',
      actual: [html.includes('Leading now'), html.includes('Standings now')],
      expected: [false, true],
    });
  });
});
