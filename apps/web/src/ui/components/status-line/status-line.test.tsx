import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { StatusLine } from './status-line';
import { PresenceDot } from '../presence-dot/presence-dot';

setupRitewayBun();

describe('StatusLine', () => {
  test('pairs a tone dot with the count text', () => {
    const view = renderAccessible(
      h(StatusLine, { tone: 'online', children: '1,248 online' }),
    );
    assert({
      given: 'an online status line',
      should: 'render the count text',
      actual: view.textContent().includes('1,248 online'),
      expected: true,
    });
  });
});

describe('PresenceDot', () => {
  test('names the presence state', () => {
    const view = renderAccessible(h(PresenceDot, { presence: 'away' }));
    assert({
      given: 'a presence dot',
      should: 'name the presence without an unrelated live-region role',
      actual: [view.has('img', 'Away'), view.has('status')],
      expected: [true, false],
    });
  });
});
