import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { segmentClass } from './segmented-class';

setupRitewayBun();

describe('segmentClass', () => {
  test('selected and not', () => {
    assert({
      given: 'a selected and an unselected segment',
      should: 'give the accent only to the selected one',
      actual: [segmentClass(true), segmentClass(false)],
      expected: [
        'inline-flex min-h-10 items-center rounded-sm px-3 text-sm font-strong whitespace-nowrap no-underline hover:no-underline bg-accent text-accent-ink hover:text-accent-ink',
        'inline-flex min-h-10 items-center rounded-sm px-3 text-sm font-strong whitespace-nowrap no-underline hover:no-underline text-ink-muted hover:text-ink',
      ],
    });
  });
});
