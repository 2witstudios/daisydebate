import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { Notice } from './notice';

setupRitewayBun();

/** The live roles a note could claim. */
const liveRoles = ['status', 'alert', 'log', 'marquee', 'timer'] as const;

describe('Notice', () => {
  test('a titled note', () => {
    const view = renderAccessible(
      h(Notice, { tone: 'gold', icon: 'alert', title: 'Heads up' }, 'Body'),
    );
    assert({
      given: 'a gold notice with a title and body',
      should: 'show both and carry no live role',
      actual: [view.textContent(), liveRoles.map((role) => view.count(role))],
      expected: ['Heads upBody', liveRoles.map(() => 0)],
    });
  });

  test('an answer', () => {
    const view = renderAccessible(
      h(Notice, {
        tone: 'accent',
        icon: 'check',
        title: 'Saved',
        announced: true,
      }),
    );
    assert({
      given: 'a notice marked as a status without a body',
      should: 'announce as a status and render no paragraph body',
      actual: [view.text('status'), view.within('status').count('paragraph')],
      expected: ['Saved', 1],
    });
  });
});
