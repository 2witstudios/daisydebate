import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { FirstVisit } from './first-visit';

setupRitewayBun();

describe('FirstVisit', () => {
  test('the empty library', () => {
    const html = renderToString(h(FirstVisit));
    assert({
      given: 'a library with nothing in it',
      should: 'lead with one h1 and offer the three starts as links',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('Start your debate library'),
        html.includes('href="/prep/cards/new"'),
        html.includes('href="/prep/briefs/new"'),
        html.includes('href="/prep/cards/new?src=file"'),
      ],
      expected: [1, true, true, true, true],
    });
  });
});
