import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
import { FreshnessNotice } from './freshness-notice';

setupRitewayBun();

const render = (freshness: 'current' | 'stale' | 'gone') =>
  renderAccessible(h(FreshnessNotice, { freshness, noun: 'room' }));

describe('FreshnessNotice', () => {
  test('only a stale or gone resource says anything', () => {
    const current = render('current');
    const stale = render('stale');
    const gone = render('gone');
    assert({
      given: 'a current, a stale and a gone room',
      should:
        'say nothing, then that it is reconnecting, then that it is gone with a way out',
      actual: [
        [
          current.textContent(),
          current.count('status'),
          current.count('alert'),
        ],
        stale.text('status').includes('Reconnecting to the room'),
        gone.within('alert').attribute('link', 'Back to the lobby', 'href'),
      ],
      expected: [['', 0, 0], true, '/lobby'],
    });
  });
});
