import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { liveCard } from '../../../features/watch/live-card.test-support';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { FeaturedRound } from './featured-round';

setupRitewayBun();

describe('FeaturedRound', () => {
  test('the featured card', () => {
    const view = renderAccessible(h(FeaturedRound, { card: liveCard() }));
    const card = view.within('region', 'Featured live debate');
    const text = card.textContent();
    assert({
      given: 'a ranked Round on the floor',
      should: 'mark it featured, with both seats, its clock and one link',
      actual: [
        text.includes('Featured'),
        text.includes('@ana'),
        text.includes('Socrates'),
        text.includes('Speaking'),
        text.includes('Listening'),
        card.text('timer'),
        card.attribute('link', 'Watch live', 'href'),
        card.count('link'),
      ],
      expected: [
        true,
        true,
        true,
        true,
        true,
        '01:10',
        '/watch/abcdefghijklmnopqrstuvwx',
        1,
      ],
    });
  });

  test('no invented numbers', () => {
    const view = renderAccessible(h(FeaturedRound, { card: liveCard() }));
    assert({
      given: 'a card from real rows',
      should: 'show no viewer count',
      actual: view.textContent().includes('watching'),
      expected: false,
    });
  });
});
