import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { NotFoundPanel } from './not-found-panel';

setupRitewayBun();

describe('NotFoundPanel', () => {
  test('names what is missing and links back', () => {
    const html = renderToString(
      h(NotFoundPanel, {
        what: 'card',
        backHref: '/prep?view=cards',
        backLabel: 'Back to cards',
      }),
    );
    assert({
      given: 'a missing card',
      should: 'say so in one h1 and link back',
      actual: [
        html.match(/<h1 /g)?.length,
        html.includes('We can’t find that card'),
        html.includes('href="/prep?view=cards"'),
      ],
      expected: [1, true, true],
    });
  });
});
