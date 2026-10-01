import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { listLive } from '../../../features/watch/list-live';
import { defaultLiveQuery } from '../../../features/watch/live-query';
import { FeaturedDebate } from './featured-debate';

setupRitewayBun();

describe('FeaturedDebate', () => {
  test('the featured card', () => {
    const card = listLive(defaultLiveQuery).featured;
    if (!card) throw new Error('sample missing');
    const html = renderToString(h(FeaturedDebate, { card, delaySeconds: 30 }));
    assert({
      given: 'the top-of-the-ladder card',
      should:
        'show why it is featured, both seats, a static clock and one link',
      actual: [
        html.includes('Featured. Highest-rated ranked debate live now'),
        html.includes('@debater-a'),
        html.includes('Speaking'),
        html.includes('Listening'),
        html.includes('03:48'),
        html.includes('delayed 30 s'),
        /<a [^>]*href="\/watch\/top-of-the-ladder"[^>]*>Watch live<\/a>/.test(
          html,
        ),
      ],
      expected: [true, true, true, true, true, true, true],
    });
  });
});
