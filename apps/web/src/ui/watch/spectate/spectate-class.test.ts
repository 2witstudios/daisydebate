import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { paneClass, paneTabClass, timelineStepClass } from './spectate-class';

setupRitewayBun();

describe('spectate classes', () => {
  test('panes', () => {
    assert({
      given: 'each pane with speeches active, then about active',
      should: 'hide inactive panes on the phone; about never shows on desktop',
      actual: [
        paneClass('speeches', 'speeches'),
        paneClass('chat', 'speeches'),
        paneClass('about', 'speeches'),
        paneClass('about', 'about'),
        paneClass('speeches', 'about'),
      ],
      expected: [
        '',
        'max-compact:hidden',
        'hidden',
        'hidden max-compact:flex',
        'max-compact:hidden',
      ],
    });
  });

  test('tabs and steps', () => {
    assert({
      given: 'selected and unselected tabs and each step state',
      should: 'accent the selected tab and color steps by state',
      actual: [
        paneTabClass(true).includes('border-accent text-accent'),
        paneTabClass(false).includes('border-transparent text-ink'),
        timelineStepClass('done').includes('bg-accent-soft'),
        timelineStepClass('current').includes('bg-accent text-accent-ink'),
        timelineStepClass('upcoming').includes('bg-surface-overlay'),
      ],
      expected: [true, true, true, true, true],
    });
  });
});
