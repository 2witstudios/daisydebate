import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { FreshnessNotice } from './freshness-notice';

setupRitewayBun();

const render = (freshness: 'current' | 'stale' | 'gone') =>
  renderToString(h(FreshnessNotice, { freshness, noun: 'room' })).replaceAll(
    '<!-- -->',
    '',
  );

describe('FreshnessNotice', () => {
  test('only a stale or gone resource says anything', () => {
    assert({
      given: 'a current, a stale and a gone room',
      should:
        'say nothing, then that it is reconnecting, then that it is gone with a way out',
      actual: [
        render('current'),
        render('stale').includes('role="status"') &&
          render('stale').includes('Reconnecting to the room'),
        render('gone').includes('role="alert"') &&
          render('gone').includes('href="/lobby"'),
      ],
      expected: ['', true, true],
    });
  });
});
