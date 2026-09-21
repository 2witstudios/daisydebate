import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { optionClass } from './theme-switcher-class';

setupRitewayBun();

const base =
  'inline-flex cursor-pointer items-center gap-2 rounded-sm border px-4 py-2 text-sm font-semibold transition-colors duration-120 ease-standard';

describe('optionClass', () => {
  test('styles the checked and unchecked states', () => {
    assert({
      given: 'a checked and an unchecked option',
      should: 'raise the checked one and quiet the other',
      actual: [optionClass(true), optionClass(false)],
      expected: [
        `${base} border-border bg-surface-raised text-ink shadow-1`,
        `${base} border-transparent bg-transparent text-ink-muted hover:text-ink`,
      ],
    });
  });
});
