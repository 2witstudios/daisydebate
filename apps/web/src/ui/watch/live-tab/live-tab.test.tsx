import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  listLive,
  type LiveHubListing,
} from '../../../features/watch/list-live';
import { defaultLiveQuery } from '../../../features/watch/live-query';
import { LiveTab } from './live-tab';

setupRitewayBun();

const render = (query = defaultLiveQuery, listing?: LiveHubListing) =>
  renderToString(h(LiveTab, { query, listing: listing ?? listLive(query) }));

describe('LiveTab', () => {
  test('the default list', () => {
    const html = render();
    assert({
      given: 'the sample live debates',
      should: 'show the filters, the feature and 7 cards',
      actual: [
        html.includes('role="search"'),
        html.includes('method="get"'),

        html.includes('Featured live debate'),
        html.split('<article').length - 1,
        html.includes('No live debates match'),
      ],
      expected: [true, true, true, 7, false],
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
    const html = render({ ...defaultLiveQuery, q: 'zzz' });
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
      delaySeconds: 30,
    };
    const html = render(defaultLiveQuery, empty);
    assert({
      given: 'no live debates at all',
      should: 'explain, offer a working notify, the archive and the lobby',
      actual: [
        html.includes('Nothing live right now'),
        html.includes('href="?did=Notify+me"'),
        html.includes('href="/recordings"'),
        html.includes('href="/lobby"'),
        html.includes('role="search"'),
      ],
      expected: [true, true, true, true, false],
    });
  });
});
