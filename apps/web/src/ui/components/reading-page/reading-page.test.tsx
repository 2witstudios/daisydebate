import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ReadingPage } from './reading-page';

setupRitewayBun();

describe('ReadingPage', () => {
  test('a centred reading column with page padding', () => {
    const html = renderToString(h(ReadingPage, { children: 'text' }));
    assert({
      given: 'content in a reading page',
      should: 'centre a reading-width column and pad it like other pages',
      actual: [
        html.includes('mx-auto'),
        html.includes('max-w-reading'),
        html.includes('px-6'),
        html.includes('>text<'),
      ],
      expected: [true, true, true, true],
    });
  });
});
