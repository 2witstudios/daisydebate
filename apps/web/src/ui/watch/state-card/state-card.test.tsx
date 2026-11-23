import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { StateCard } from './state-card';

setupRitewayBun();

describe('StateCard', () => {
  test('a page-level state', () => {
    const view = renderAccessible(
      h(StateCard, {
        icon: 'eye',
        title: 'Nothing here',
        level: 'h1',
        actions: h('a', { href: '/x' }, 'Go'),
        children: h('p', null, 'Why.'),
      }),
    );
    assert({
      given: 'a card that is the whole page',
      should: 'use an h1 and show its text and actions',
      actual: [
        view.has('heading', 'Nothing here', { level: 1 }),
        view.textContent().includes('Why.'),
        view.attribute('link', 'Go', 'href'),
      ],
      expected: [true, true, '/x'],
    });
  });

  test('a card inside a list', () => {
    const view = renderAccessible(
      h(StateCard, {
        icon: 'eye',
        title: 'Empty',
        children: h('p', null, 'Text'),
      }),
    );
    assert({
      given: 'a card with no level and no actions',
      should: 'use an h2',
      actual: [
        view.has('heading', 'Empty', { level: 2 }),
        view.count('heading', undefined, { level: 1 }),
      ],
      expected: [true, 0],
    });
  });
});
