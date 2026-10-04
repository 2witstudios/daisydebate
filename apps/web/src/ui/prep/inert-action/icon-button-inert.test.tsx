import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { IconButtonInert } from './icon-button-inert';

setupRitewayBun();

describe('IconButtonInert', () => {
  test('named and answering as a sample action', () => {
    const html = renderToString(
      h(IconButtonInert, { label: 'Detach card', symbol: 'x' }),
    );
    assert({
      given: 'a detach control',
      should: 'be a link with an accessible name that answers on the same page',
      actual: [
        html.includes('href="?did=Detach+card"'),
        html.includes('aria-label="Detach card"'),
        html.includes('disabled=""'),
      ],
      expected: [true, true, false],
    });
  });
});
