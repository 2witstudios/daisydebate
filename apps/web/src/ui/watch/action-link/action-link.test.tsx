import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ActionLink } from './action-link';

setupRitewayBun();

describe('ActionLink', () => {
  test('a real link styled as a button', () => {
    const html = renderToString(
      h(ActionLink, {
        href: '/lobby',
        variant: 'primary',
        children: 'Open the lobby',
      }),
    );
    assert({
      given: 'a primary action link',
      should: 'render an anchor with the href and the primary button classes',
      actual: [
        /<a [^>]*href="\/lobby"/.test(html),
        html.includes('bg-accent'),
        html.includes('Open the lobby'),
      ],
      expected: [true, true, true],
    });
  });
});
