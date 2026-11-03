import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { liveCard } from '../../../features/watch/live-card.test-support';
import { FeaturedRound } from './featured-round';

setupRitewayBun();

describe('FeaturedRound', () => {
  test('the featured card', () => {
    const html = renderToString(h(FeaturedRound, { card: liveCard() }));
    assert({
      given: 'a ranked Round on the floor',
      should: 'mark it featured, with both seats, its clock and one link',
      actual: [
        html.includes('>Featured<'),
        html.includes('@ana'),
        html.includes('Socrates'),
        html.includes('Speaking'),
        html.includes('Listening'),
        html.includes('01:10'),
        /<a [^>]*href="\/watch\/abcdefghijklmnopqrstuvwx"[^>]*>Watch live<\/a>/.test(
          html,
        ),
      ],
      expected: [true, true, true, true, true, true, true],
    });
  });

  test('no invented numbers', () => {
    const html = renderToString(h(FeaturedRound, { card: liveCard() }));
    assert({
      given: 'a card from real rows',
      should: 'show no viewer count',
      actual: html.includes('watching'),
      expected: false,
    });
  });
});
