import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { cardClass, chipClass } from './choice-class';

setupRitewayBun();

describe('choice classes', () => {
  test('chips and cards restyle from the checked radio', () => {
    assert({
      given: 'the chip and card classes',
      should:
        'carry the literal classes, selected state coming from has-checked',
      actual: [chipClass, cardClass],
      expected: [
        'inline-flex min-h-12 cursor-pointer items-center rounded-sm border border-border bg-surface-raised px-4 text-base font-strong text-ink-muted has-checked:border-accent has-checked:bg-accent-soft has-checked:text-accent has-focus-visible:border-accent',
        'flex min-h-12 w-full cursor-pointer items-start gap-4 rounded-lg border border-border bg-surface-raised p-4 text-base text-ink has-checked:border-accent has-checked:bg-accent-soft has-focus-visible:border-accent',
      ],
    });
  });
});
