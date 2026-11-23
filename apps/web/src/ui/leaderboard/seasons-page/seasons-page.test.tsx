import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { NOW } from '../../../features/leaderboard/ladder.test-support';
import { readLadder } from '../../../features/leaderboard/read-leaderboard.test-support';
import { buildSeasonsView } from '../../../features/leaderboard/seasons';
import {
  renderAccessible,
  type AccessibleView,
} from '../../../test-support/rendered/accessible';
import { SeasonsPage } from './seasons-page';

setupRitewayBun();

const open = { style: 'freestyle', division: 'open' } as const;

const render = (season: string | null, entries?: 'none') => {
  const data = readLadder(season, NOW, null).data;
  const view = buildSeasonsView(
    entries ? { ...data, entries: [] } : data,
    open,
    NOW,
  );
  return renderAccessible(h(SeasonsPage, { view }));
};

/** Whether a piece of the page reads exactly this, hidden pieces included. */
const shows = (view: AccessibleView, text: string | RegExp) =>
  view
    .all('generic', undefined, { hidden: true })
    .some((element) =>
      typeof text === 'string'
        ? element.textContent === text
        : text.test(element.textContent ?? ''),
    );

const hrefs = (links: readonly Element[]) =>
  links.map((link) => link.getAttribute('href'));

describe('SeasonsPage', () => {
  test('the live season', () => {
    const view = render(null);
    const text = view.textContent();
    assert({
      given: 'the live season',
      should:
        'show one h1, season chips as links, the leader, ten rows and the explainer anchor',
      actual: [
        view.count('heading', undefined, { level: 1 }),
        hrefs(view.within('navigation', 'Season').all('link')).includes(
          '/leaderboard/seasons?division=open&season=3',
        ),
        view.has('region', 'Leading now'),
        view.has('region', 'Standings now'),
        view.within('region', 'Standings now').count('listitem'),
        view.get('heading', 'How rating works', { level: 2 }).parentElement?.id,
        text.includes('Provisional while rating deviation is above 110.'),
        text.includes('Current season'),
        hrefs(view.all('link', 'Open the full ladder')),
        text.includes('One ladder per season'),
      ],
      expected: [
        1,
        true,
        true,
        true,
        10,
        'how-rating-works',
        true,
        true,
        [
          '/leaderboard?division=open&season=4',
          '/leaderboard?division=open&season=4',
        ],
        true,
      ],
    });
  });

  test('a closed season', () => {
    const view = render('3');
    assert({
      given: 'a closed season',
      should:
        'name the champion, label the standings final and show the season change column',
      actual: [
        view.has('region', 'Champion'),
        view.has('region', 'Final standings'),
        shows(view, 'Season'),
        view.attribute('progressbar', 'Season progress', 'value'),
        view
          .within('navigation', 'Season')
          .count('link', undefined, { current: 'page' }),
      ],
      expected: [true, true, true, '100', 1],
    });
    assert({
      given: 'the closed season champion',
      should: 'give only the rating and the W–L record, with no tier',
      actual: view
        .within('region', 'Champion')
        .all('generic')
        .some((element) =>
          /^\d+ · \d+–\d+ W–L$/.test(element.textContent ?? ''),
        ),
      expected: true,
    });
  });

  test('the range picture', () => {
    const view = render(null);
    assert({
      given: 'the explainer',
      should: 'draw a labelled picture of a wide and a narrow range',
      actual: [
        view.has(
          'img',
          'A provisional rating has a wide range; an established rating has a narrow one.',
        ),
        view.textContent().includes('Provisional'),
        view.textContent().includes('Hollow marker: provisional.'),
      ],
      expected: [true, true, true],
    });
  });

  test('no active season', () => {
    const view = renderAccessible(h(SeasonsPage, { view: null }));
    assert({
      given: 'no active season',
      should: 'say so under the page title',
      actual: [
        view.textContent().includes('No season is active.'),
        view.has('heading', 'Seasons', { level: 1 }),
      ],
      expected: [true, true],
    });
  });

  test('a closed season with no active one', () => {
    const data = readLadder('3', NOW, null).data;
    const view = buildSeasonsView(
      { ...data, seasons: data.seasons.filter(({ id }) => id !== '4') },
      open,
      NOW,
    );
    const text = renderAccessible(h(SeasonsPage, { view })).textContent();
    assert({
      given: 'only closed seasons',
      should: 'say none is active before that season’s standings',
      actual:
        text.indexOf('No season is active.') > -1 &&
        text.indexOf('No season is active.') < text.indexOf('Final standings'),
      expected: true,
    });
  });

  test('no one established', () => {
    const view = render(null, 'none');
    assert({
      given: 'a season with no one established',
      should: 'still render without a champion',
      actual: [
        view.textContent().includes('Leading now'),
        view.has('region', 'Standings now'),
      ],
      expected: [false, true],
    });
  });
});
