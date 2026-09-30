import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { LiveClock } from './live-clock';

setupRitewayBun();

describe('LiveClock', () => {
  test('renders a static value with no script', () => {
    const html = renderToString(h(LiveClock, { initialSeconds: 228 }));
    assert({
      given: '228 seconds left at render time',
      should: 'show 03:48 in a timer element',
      actual: [html.includes('03:48'), html.includes('role="timer"')],
      expected: [true, true],
    });
  });
});
