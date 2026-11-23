import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { Badge } from './badge';

setupRitewayBun();

describe('Badge', () => {
  test('renders its label as a span', () => {
    const view = renderAccessible(h(Badge, { tone: 'live', children: 'Live' }));
    assert({
      given: 'a live-tone badge',
      should: 'render the label text',
      actual: [view.get('generic').tagName, view.text('generic')],
      expected: ['SPAN', 'Live'],
    });
  });

  test('accepts any tone without changing the markup shape', () => {
    const neutral = renderAccessible(h(Badge, { children: 'Ranked' })).text(
      'generic',
    );
    const gold = renderAccessible(
      h(Badge, { tone: 'gold', children: 'Ranked' }),
    ).text('generic');
    assert({
      given: 'the same label with different tones',
      should: 'render the same text content',
      actual: neutral === 'Ranked' && gold === 'Ranked',
      expected: true,
    });
  });
});
