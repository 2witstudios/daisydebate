import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { LadderHeading } from './ladder-heading';

setupRitewayBun();

describe('LadderHeading', () => {
  test('heads and the movement column', () => {
    const live = renderAccessible(h(LadderHeading, { closed: false }));
    const visible = live.count('generic');
    // The row and its five heads, all hidden.
    const hidden = live.count('generic', undefined, { hidden: true });
    const heads = live.textContent();
    const closed = renderAccessible(
      h(LadderHeading, { closed: true }),
    ).textContent();
    assert({
      given: 'a live and a closed season',
      should:
        'hide from assistive tech, list five heads and name the movement column',
      actual: [visible, hidden, heads, closed],
      expected: [
        0,
        6,
        'RankDebaterRatingW–L7 days',
        'RankDebaterRatingW–LSeason',
      ],
    });
  });
});
