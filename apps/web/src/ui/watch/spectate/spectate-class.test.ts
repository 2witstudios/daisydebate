import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { paneTabClass, timelineStepClass } from './spectate-class';

setupRitewayBun();

describe('spectate classes', () => {
  test('tabs and steps', () => {
    assert({
      given: 'selected and unselected tabs and each step state',
      should: 'accent the selected tab and color steps by state',
      actual: [
        paneTabClass(true).includes('border-accent text-accent'),
        paneTabClass(false).includes('border-transparent text-ink'),
        timelineStepClass('done').includes('bg-surface-overlay'),
        timelineStepClass('current').includes('bg-accent text-accent-ink'),
        timelineStepClass('upcoming').includes('border border-border'),
      ],
      expected: [true, true, true, true, true],
    });
  });
});
