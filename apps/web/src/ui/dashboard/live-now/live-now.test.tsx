import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { liveCard } from '../../../features/watch/live-card.test-support';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { LiveNow } from './live-now';

setupRitewayBun();

describe('LiveNow', () => {
  test('nothing live', () => {
    const view = renderAccessible(h(LiveNow, { rounds: [] })).within(
      'region',
      'Live now',
    );
    assert({
      given: 'no live Rounds',
      should: 'say so, and still lead to the listing',
      actual: [
        view.textContent().includes('Nothing live right now.'),
        view.attribute('link', 'See all live debates', 'href'),
      ],
      expected: [true, '/watch'],
    });
  });

  test('a live Round', () => {
    const view = renderAccessible(h(LiveNow, { rounds: [liveCard()] })).within(
      'region',
      'Live now',
    );
    assert({
      given: 'a live Round',
      should: 'link straight to it, with no invented count',
      actual: [
        view.attribute('link', 'Friday night', 'href'),
        view.textContent().includes('watching'),
      ],
      expected: ['/watch/abcdefghijklmnopqrstuvwx', false],
    });
  });
});
