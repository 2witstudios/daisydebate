import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { WatchTabs } from './watch-tabs';

setupRitewayBun();

describe('WatchTabs', () => {
  test('three links, the active one current', () => {
    const html = renderToString(
      h(WatchTabs, {
        active: 'recordings',
        counts: { live: 8, recordings: 6 },
      }),
    );
    assert({
      given: 'the recordings section active',
      should: 'link to the hub, the guarded archive and the following view',
      actual: [
        html.includes('href="/watch"'),
        html.includes('href="/recordings"'),
        html.includes('href="/watch?tab=following"'),
        (html.match(/aria-current="page"/g) ?? []).length,
        /aria-current="page"[^>]*>Recordings/.test(html),
      ],
      expected: [true, true, true, 1, true],
    });
  });

  test('counts', () => {
    const html = renderToString(
      h(WatchTabs, { active: 'live', counts: { live: 8, recordings: 6 } }),
    );
    assert({
      given: 'counts for live and recordings',
      should: 'show them, and none on Following',
      actual: [html.includes('>8<'), html.includes('>6<')],
      expected: [true, true],
    });
  });
});
