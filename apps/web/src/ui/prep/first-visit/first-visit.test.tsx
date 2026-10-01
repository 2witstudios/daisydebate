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
      should:
        'lead with one h1, offer the three starts as links and keep the speech time a placeholder',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('Start your debate library'),
        html.includes('href="/prep/cards/new"'),
        html.includes('href="/prep/briefs/new"'),
        html.includes('href="/prep/cards/new?src=file"'),
        html.includes('([speech time])'),
        html.includes('Run a search with filters'),
      ],
      expected: [1, true, true, true, true, true, true],
    });
  });
});
