import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { watchViewer } from '../../../features/watch/debate-source';
import {
  listRecordings,
  type RecordingsHubListing,
} from '../../../features/watch/list-recordings';
import {
  defaultRecordingsQuery,
  type RecordingsQuery,
} from '../../../features/watch/recordings-query';
import { RecordingsTab } from './recordings-tab';

setupRitewayBun();

const render = (query: RecordingsQuery, listing?: RecordingsHubListing) =>
  renderToString(
    h(RecordingsTab, {
      query,
      listing: listing ?? listRecordings(query, watchViewer(true)),
    }),
  );

describe('RecordingsTab', () => {
  test('the public archive', () => {
    const html = render(defaultRecordingsQuery);
    assert({
      given: 'the default query',
      should: 'show the GET filter form, the scope note and six rows',
      actual: [
        /<form [^>]*action="\/recordings"/.test(html),
        html.includes('method="get"'),
        html.includes('The public archive lists public debates only.'),
        (html.match(/aria-label="Replay /g) ?? []).length,
      ],
      expected: [true, true, true, 6],
    });
  });

  test('a filter that matches nothing', () => {
    const html = render({ ...defaultRecordingsQuery, q: 'zzz' });
    assert({
      given: 'a search with no match',
      should: 'offer Clear filters back to the archive',
      actual: [
        html.includes('No recordings match'),
        /<a [^>]*href="\/recordings"[^>]*>Clear filters<\/a>/.test(html),
      ],
      expected: [true, true],
    });
  });

  test('no recordings of my own', () => {
    const html = render(
      { ...defaultRecordingsQuery, scope: 'mine' },
      { rows: [], inScope: 0 },
    );
    assert({
      given: 'an empty my-debates scope',
      should: 'invite to find a match or open the lobby',
      actual: [
        html.includes('You have no recorded debates yet'),
        html.includes('href="/ranked"'),
        html.includes('href="/lobby"'),
      ],
      expected: [true, true, true],
    });
  });

  test('an empty public archive', () => {
    const html = render(defaultRecordingsQuery, { rows: [], inScope: 0 });
    assert({
      given: 'no public recordings at all',
      should: 'say so and point to what is live',
      actual: [
        html.includes('No recordings yet'),
        html.includes('href="/watch"'),
        html.includes('role="search"'),
      ],
      expected: [true, true, true],
    });
  });
});
