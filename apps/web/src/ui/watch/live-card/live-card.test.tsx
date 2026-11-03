import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { liveCard } from '../../../features/watch/live-card.test-support';
import { LiveCard } from './live-card';

setupRitewayBun();

describe('LiveCard', () => {
  test('a live Round', () => {
    const html = renderToString(h(LiveCard, { card: liveCard() }));
    assert({
      given: 'a released Round on the floor',
      should:
        'show title, resolution, seats, phase, a ranked chip and one Watch link, with no invented count',
      actual: [
        html.includes('Friday night'),
        html.includes('A drawn resolution'),
        html.includes('@ana'),
        html.includes('Socrates'),
        html.includes('First affirmative'),
        html.includes('>Ranked<'),
        html.includes('watching'),
        /<a [^>]*href="\/watch\/abcdefghijklmnopqrstuvwx"/.test(html),
        html.split('<a ').length - 1,
      ],
      expected: [true, true, true, true, true, true, false, true, 1],
    });
  });
});
