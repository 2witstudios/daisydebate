import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { LiveHubListing } from '../../../features/watch/list-live';
import { liveCard } from '../../../features/watch/live-card.test-support';
import { defaultLiveQuery } from '../../../features/watch/live-query';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { LiveTab } from './live-tab';

setupRitewayBun();

const someLive: LiveHubListing = {
  featured: liveCard({ id: 'featured-round' }),
  rows: ['one', 'two'].map((id) => liveCard({ id, competitionType: 'casual' })),
  total: 3,
  nextBefore: null,
};
const render = (query = defaultLiveQuery, listing = someLive) =>
  renderAccessible(h(LiveTab, { query, listing }));

describe('LiveTab', () => {
  test('the default list', () => {
    const view = render();
    assert({
      given: 'real live Rounds',
      should: 'show the filters, the feature and the cards',
      actual: [
        view.has('search', 'Filter live debates'),
        view.attribute('search', 'Filter live debates', 'method'),
        view.has('region', 'Featured live debate'),
        view.count('article'),
        view.has('heading', 'No live debates match'),
      ],
      expected: [true, 'get', true, 2, false],
    });
  });

  test('the filters are a plain form', () => {
    const view = render({ ...defaultLiveQuery, mode: 'ranked', q: 'a' });
    const form = view.within('search', 'Filter live debates');
    assert({
      given: 'a filtered hub',
      should: 'be a GET form to /watch with a submit button and a Clear link',
      actual: [
        view.attribute('search', 'Filter live debates', 'action'),
        form.attribute('button', 'Apply', 'type'),
        form.has('link', 'Clear'),
      ],
      expected: ['/watch', 'submit', true],
    });
  });

  test('a filter that matches nothing', () => {
    const view = render(
      { ...defaultLiveQuery, q: 'zzz' },
      { featured: null, rows: [], total: 3, nextBefore: null },
    );
    assert({
      given: 'a search with no match',
      should: 'say so and offer Clear filters back to the hub',
      actual: [
        view.has('heading', 'No live debates match'),
        view.attribute('link', 'Clear filters', 'href'),
        view.count('article'),
      ],
      expected: [true, '/watch', 0],
    });
  });

  test('nothing is live', () => {
    const empty: LiveHubListing = {
      featured: null,
      rows: [],
      total: 0,
      nextBefore: null,
    };
    const view = render(defaultLiveQuery, empty);
    assert({
      given: 'no live Rounds at all',
      should: 'explain, and offer the archive and the lobby',
      actual: [
        view.has('heading', 'Nothing live right now'),
        view
          .all('link')
          .some((link) => link.getAttribute('href')?.includes('?did=')),
        view.attribute('link', 'Browse recordings', 'href'),
        view.attribute('link', 'Open the lobby', 'href'),
        view.count('search'),
      ],
      expected: [true, false, '/recordings', '/lobby', 0],
    });
  });

  test('more than one page', () => {
    const view = render(defaultLiveQuery, { ...someLive, nextBefore: 'one' });
    assert({
      given: 'a next page',
      should: 'link to it before hydration',
      actual: view.attribute('link', 'More live debates', 'href'),
      expected: '/watch?before=one',
    });
  });
});
