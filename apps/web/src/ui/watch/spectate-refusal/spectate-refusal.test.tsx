import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { SpectateRefusal } from './spectate-refusal';

setupRitewayBun();

describe('SpectateRefusal', () => {
  test('one answer', () => {
    const html = renderToString(h(SpectateRefusal));
    assert({
      given: 'a private or missing Round',
      should: 'say only that it is not available, with ways on',
      actual: [
        html.includes('This debate is not available'),
        html.includes('href="/watch"'),
        html.includes('href="/recordings"'),
      ],
      expected: [true, true, true],
    });
  });
});
