import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  ListSkeleton,
  LoadFailed,
  NoMatches,
  NothingOpen,
} from './list-states';

setupRitewayBun();

describe('list states', () => {
  test('loading announces itself and hides the placeholders', () => {
    const html = renderToString(h(ListSkeleton));
    assert({
      given: 'the skeleton',
      should: 'be busy, name what is loading, and hide the boxes from tech',
      actual: [
        html.includes('aria-busy="true"'),
        /role="status"[^>]*>Loading tournaments</.test(html),
        html.includes('aria-hidden="true"'),
        html.match(/<li /g)?.length,
      ],
      expected: [true, true, true, 3],
    });
  });

  test('nothing open offers to be told or to create', () => {
    const html = renderToString(h(NothingOpen));
    assert({
      given: 'an empty tab',
      should: 'explain, offer a disabled notify action and a create link',
      actual: [
        html.includes('No tournaments are open for registration'),
        html.includes('Tell me about new events'),
        /disabled=""/.test(html),
        html.includes('href="/tournaments/organize/new"'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('no matches links to the cleared filters', () => {
    const html = renderToString(
      h(NoMatches, { clearHref: '/tournaments?tab=live' }),
    );
    assert({
      given: 'filters that match nothing on the live tab',
      should: 'link Clear filters to the tab URL',
      actual: [
        html.includes('No tournaments match these filters'),
        /href="\/tournaments\?tab=live"[^>]*>Clear filters</.test(html),
      ],
      expected: [true, true],
    });
  });

  test('a failed load is an alert with a retry button', () => {
    const html = renderToString(h(LoadFailed, { retry: () => undefined }));
    assert({
      given: 'a load failure',
      should: 'announce as an alert and offer Try again',
      actual: [
        /role="alert"[^>]*>Tournaments did not load</.test(html),
        /<button type="button"[^>]*>Try again</.test(html),
      ],
      expected: [true, true],
    });
  });
});
