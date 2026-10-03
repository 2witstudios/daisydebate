import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { mockNextRouter } from '../../../lib/testing/mock-router';

setupRitewayBun();

// The toggle reads the Next router, which only exists in a running app, so
// the server render is checked through a stub router.
await mockNextRouter();
const { PlayToggle } = await import('./play-toggle');

describe('PlayToggle', () => {
  test('before hydration it is disabled and says why', () => {
    const html = renderToString(
      h(PlayToggle, { tickHref: '/recordings/a?t=1', tickMs: 1000 }),
    );
    assert({
      given: 'a server render',
      should: 'show a disabled Play button explaining it needs JavaScript',
      actual: [
        /<button [^>]*disabled=""/.test(html),
        html.includes('aria-label="Play"'),
        html.includes('needs JavaScript'),
      ],
      expected: [true, true, true],
    });
  });
});
