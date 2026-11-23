import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { LiveClock } from './live-clock';

setupRitewayBun();

describe('LiveClock', () => {
  test('renders a static value before hydration', () => {
    const view = renderAccessible(h(LiveClock, { initialSeconds: 228 }));
    assert({
      given: '228 seconds left at render time',
      should: 'show 03:48 in a timer element',
      actual: view.text('timer'),
      expected: '03:48',
    });
  });
});
