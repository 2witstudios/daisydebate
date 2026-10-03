import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { BackLink } from './back-link';

setupRitewayBun();

describe('BackLink', () => {
  test('a link with its words', () => {
    const html = renderToString(
      h(BackLink, { href: '/train/progress', children: 'Train' }),
    );
    assert({
      given: 'a back link to Train',
      should: 'link there with the words and hide the arrow from readers',
      actual: [
        html.includes('href="/train/progress"'),
        html.includes('Train'),
        html.includes('aria-hidden="true"'),
      ],
      expected: [true, true, true],
    });
  });
});
