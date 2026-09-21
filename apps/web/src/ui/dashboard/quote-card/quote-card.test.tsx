import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { QuoteCard } from './quote-card';

setupRitewayBun();

describe('QuoteCard', () => {
  test('presents the quote over a decorative photograph', () => {
    const html = renderToString(h(QuoteCard));
    assert({
      given: 'the quote card',
      should: 'render a blockquote and hide the backdrop image from readers',
      actual: [
        /<blockquote[^>]*>Ideas move people\./.test(html),
        /<img[^>]* alt=""/.test(html),
      ],
      expected: [true, true],
    });
  });
});
