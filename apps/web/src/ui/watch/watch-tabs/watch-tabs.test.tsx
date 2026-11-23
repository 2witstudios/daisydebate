import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { WatchTabs } from './watch-tabs';

setupRitewayBun();

describe('WatchTabs', () => {
  test('three links, the active one current', () => {
    const view = renderAccessible(
      h(WatchTabs, {
        active: 'recordings',
        counts: { live: 8, recordings: 6 },
      }),
    );
    const tabs = view.within('navigation', 'Watch sections');
    assert({
      given: 'the recordings section active',
      should: 'link to the hub, the guarded archive and the following view',
      actual: [
        tabs.attribute('link', 'Live 8', 'href'),
        tabs.attribute('link', 'Recordings 6', 'href'),
        tabs.attribute('link', 'Following', 'href'),
        tabs.count('link', undefined, { current: 'page' }),
        tabs.has('link', 'Recordings 6', { current: 'page' }),
      ],
      expected: ['/watch', '/recordings', '/watch?tab=following', 1, true],
    });
  });

  test('counts', () => {
    const view = renderAccessible(
      h(WatchTabs, { active: 'live', counts: { live: 8, recordings: 6 } }),
    );
    assert({
      given: 'counts for live and recordings',
      should: 'show them, and none on Following',
      actual: view.names('link'),
      expected: ['Live 8', 'Recordings 6', 'Following'],
    });
  });
});
