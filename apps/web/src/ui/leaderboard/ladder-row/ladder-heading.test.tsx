import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { LadderHeading } from './ladder-heading';

setupRitewayBun();

describe('LadderHeading', () => {
  test('heads and the movement column', () => {
    const live = renderToString(h(LadderHeading, { closed: false }));
    assert({
      given: 'a live and a closed season',
      should:
        'hide from assistive tech, list six heads and name the movement column',
      actual: [
        live.includes('aria-hidden="true"'),
        live.match(/<span/g)?.length,
        live.includes('>7 days<'),
        renderToString(h(LadderHeading, { closed: true })).includes('>Season<'),
      ],
      expected: [true, 6, true, true],
    });
  });
});
