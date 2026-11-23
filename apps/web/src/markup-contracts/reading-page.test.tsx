import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { ReadingPage } from '../ui/components/reading-page/reading-page';

setupRitewayBun();

/**
 * The reading page is a layout primitive with no role of its own: its whole
 * contract is the design-system column classes (centred, reading width, page
 * padding), which no role, name or state expresses.
 */
describe('ReadingPage', () => {
  test('a centred reading column with page padding', () => {
    const html = renderMarkup(h(ReadingPage, { children: 'text' }));
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
