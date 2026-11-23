import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import NotFound from './not-found';

setupRitewayBun();

describe('NotFound', () => {
  test('offers the way home and a way to contact support', () => {
    const html = renderToString(h(NotFound));
    assert({
      given: 'a page that does not exist',
      should: 'link home and to /support',
      actual: [html.includes('href="/"'), html.includes('href="/support"')],
      expected: [true, true],
    });
  });
});
