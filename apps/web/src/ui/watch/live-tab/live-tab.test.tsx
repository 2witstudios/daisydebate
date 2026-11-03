import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { LiveHubListing } from '../../../features/watch/list-live';
import { liveCard } from '../../../features/watch/live-card.test-support';
import { defaultLiveQuery } from '../../../features/watch/live-query';
import { LiveTab } from './live-tab';

setupRitewayBun();

const someLive: LiveHubListing = {
  featured: liveCard({ id: 'featured-round' }),
  rows: ['one', 'two'].map((id) => liveCard({ id, competitionType: 'casual' })),
  total: 3,
  nextBefore: null,
};
const render = (query = defaultLiveQuery, listing = someLive) =>
  renderToString(h(LiveTab, { query, listing }));

describe('LiveTab', () => {
  test('the default list', () => {
    const html = render();
    assert({
      given: 'real live Rounds',
      should: 'show the filters, the feature and the cards',
      actual: [
        html.includes('role="search"'),
        html.includes('method="get"'),

        html.includes('Featured live debate'),
        html.split('<article').length - 1,
        html.includes('No live debates match'),
      ],
      expected: [true, true, true, 2, false],
    });
  });

  test('no JavaScript contract', () => {
    const html = render({ ...defaultLiveQuery, mode: 'ranked', q: 'a' });
    assert({
      given: 'a filtered hub',
      should: 'be a GET form to /watch with a submit button and a Clear link',
      actual: [
        /<form [^>]*action="\/watch"/.test(html),
        /<button type="submit"[^>]*>Apply/.test(html),
        html.includes('>Clear<'),
      ],
      expected: [true, true, true],
    });
  });

  test('a filter that matches nothing', () => {
    const html = render(
      { ...defaultLiveQuery, q: 'zzz' },
      { featured: null, rows: [], total: 3, nextBefore: null },
    );
    assert({
      given: 'a search with no match',
      should: 'say so and offer Clear filters back to the hub',
      actual: [
        html.includes('No live debates match'),
        /<a [^>]*href="\/watch"[^>]*>Clear filters<\/a>/.test(html),
        html.includes('<article'),
      ],
      expected: [true, true, false],
    });
  });

  test('nothing is live', () => {
    const empty: LiveHubListing = {
      featured: null,
      rows: [],
      total: 0,
      nextBefore: null,
    };
    const html = render(defaultLiveQuery, empty);
    assert({
      given: 'no live Rounds at all',
      should: 'explain, and offer the archive and the lobby',
      actual: [
        html.includes('Nothing live right now'),
        html.includes('?did='),
        html.includes('href="/recordings"'),
        html.includes('href="/lobby"'),
        html.includes('role="search"'),
      ],
      expected: [true, false, true, true, false],
    });
  });

  test('more than one page', () => {
    const html = render(defaultLiveQuery, { ...someLive, nextBefore: 'one' });
    assert({
      given: 'a next page',
      should: 'link to it with no script',
      actual: html.includes('href="/watch?before=one"'),
      expected: true,
    });
  });
});
