import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { liveCard } from '../../../features/watch/live-card.test-support';
import { LiveNow } from './live-now';

setupRitewayBun();

describe('LiveNow', () => {
  test('nothing live', () => {
    const html = renderToString(h(LiveNow, { rounds: [] }));
    assert({
      given: 'no live Rounds',
      should: 'say so, and still lead to the listing',
      actual: [
        html.includes('Nothing live right now.'),
        html.includes('href="/watch"'),
      ],
      expected: [true, true],
    });
  });

  test('a live Round', () => {
    const html = renderToString(h(LiveNow, { rounds: [liveCard()] }));
    assert({
      given: 'a live Round',
      should: 'link straight to it, with no invented count',
      actual: [
        html.includes('href="/watch/abcdefghijklmnopqrstuvwx"'),
        html.includes('Friday night'),
        html.includes('watching'),
      ],
      expected: [true, true, false],
    });
  });
});
