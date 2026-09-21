import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { buttonClass } from './button-class';

setupRitewayBun();

const base =
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-sm border text-base leading-tight font-strong transition-colors duration-120 ease-standard disabled:cursor-not-allowed disabled:opacity-60';

describe('buttonClass', () => {
  test('primary fills with the accent', () => {
    assert({
      given: 'the primary variant',
      should: 'add the accent fill and its hover to the base',
      actual: buttonClass('primary'),
      expected: `${base} border-transparent bg-accent px-5 py-3 text-accent-ink hover:bg-accent-strong`,
    });
  });

  test('secondary outlines with the strong border', () => {
    assert({
      given: 'the secondary variant',
      should: 'add a transparent fill with the strong border',
      actual: buttonClass('secondary'),
      expected: `${base} border-border-strong bg-transparent px-5 py-3 text-ink hover:border-ink-muted hover:text-ink`,
    });
  });

  test('ghost is quiet and tighter', () => {
    assert({
      given: 'the ghost variant',
      should: 'add muted ink with tighter padding',
      actual: buttonClass('ghost'),
      expected: `${base} border-transparent bg-transparent px-3 py-2 text-ink-muted hover:text-ink`,
    });
  });
});
