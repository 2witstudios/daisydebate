import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { WatchHub } from './watch-hub';

setupRitewayBun();

describe('WatchHub', () => {
  test('frames a section', () => {
    const view = renderAccessible(
      h(WatchHub, {
        active: 'live',
        counts: { live: 1, recordings: 2 },
        children: h('p', null, 'Body'),
      }),
    );
    assert({
      given: 'the live section',
      should: 'show the Watch title, the tabs and the body',
      actual: [
        view.has('heading', 'Watch', { level: 1 }),
        view.has('navigation', 'Watch sections'),
        view.textContent().includes('Body'),
      ],
      expected: [true, true, true],
    });
  });
});
