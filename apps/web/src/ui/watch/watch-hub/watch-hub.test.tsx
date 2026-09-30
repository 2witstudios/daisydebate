import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { WatchHub } from './watch-hub';

setupRitewayBun();

describe('WatchHub', () => {
  test('frames a section', () => {
    const html = renderToString(
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
        html.includes('<h1'),
        html.includes('Watch sections'),
        html.includes('Body'),
      ],
      expected: [true, true, true],
    });
  });
});
