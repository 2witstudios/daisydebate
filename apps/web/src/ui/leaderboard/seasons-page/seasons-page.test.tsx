import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { NOW } from '../../../features/leaderboard/ladder.test-support';
import { readLadder } from '../../../features/leaderboard/read-leaderboard';
import { buildSeasonsView } from '../../../features/leaderboard/seasons';
import { SeasonsPage } from './seasons-page';

setupRitewayBun();

const render = (season: number | null, entries?: 'none') => {
  const data = readLadder(season, NOW, null).data;
  const view = buildSeasonsView(entries ? { ...data, entries: [] } : data, NOW);
  return renderToString(h(SeasonsPage, { view })).replace(/<!-- -->/g, '');
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
        html.includes('Unranked until 10 ranked debates.'),
        html.includes('Current season'),
        html.match(/href="\/leaderboard\?season=4"/g)?.length,
      ],
      expected: [1, true, true, true, 10, true, true, true, 2],
    });
  });

  test('a closed season', () => {
    const html = render(3);
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
      ],
      expected: [true, true, true, true, true],
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
