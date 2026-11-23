import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { liveCard } from '../../../features/watch/live-card.test-support';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { LiveCard } from './live-card';

setupRitewayBun();

describe('LiveCard', () => {
  test('a live Round', () => {
    const view = renderAccessible(h(LiveCard, { card: liveCard() }));
    const card = view.within('article');
    const text = card.textContent();
    assert({
      given: 'a released Round on the floor',
      should:
        'show title, resolution, seats, phase, a ranked chip and one Watch link, with no invented count',
      actual: [
        card.has('heading', 'Friday night', { level: 3 }),
        text.includes('A drawn resolution'),
        text.includes('@ana'),
        text.includes('Socrates'),
        text.includes('First affirmative'),
        text.includes('Ranked'),
        text.includes('watching'),
        card.attribute('link', 'Watch Friday night', 'href'),
        card.count('link'),
      ],
      expected: [
        true,
        true,
        true,
        true,
        true,
        true,
        false,
        '/watch/abcdefghijklmnopqrstuvwx',
        1,
      ],
    });
  });

  test('names no ladder', () => {
    assert({
      given: 'a ranked Round on Open – Freestyle',
      should: 'show no ladder badge',
      actual: renderAccessible(h(LiveCard, { card: liveCard() }))
        .textContent()
        .includes('Open – Freestyle'),
      expected: false,
    });
  });
});
