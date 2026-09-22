import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { navCaretClass, navItemClass } from './nav-item-class';

setupRitewayBun();

const base =
  'flex items-center gap-3 rounded-md px-4 py-3 text-md font-semibold no-underline transition-colors duration-120 ease-standard hover:no-underline max-compact:justify-center max-compact:px-0';
const caretBase =
  'inline-flex opacity-0 transition-opacity duration-120 ease-standard group-focus-within:opacity-100 group-hover:opacity-100 max-compact:hidden';

describe('navItemClass', () => {
  test('inactive', () => {
    assert({
      given: 'an inactive item',
      should: 'use muted ink with a surface hover',
      actual: navItemClass(false),
      expected: `${base} text-ink-muted hover:bg-surface hover:text-ink`,
    });
  });

  test('active', () => {
    assert({
      given: 'the active item',
      should: 'fill with the accent and keep it on hover',
      actual: navItemClass(true),
      expected: `${base} bg-accent-soft text-accent-strong hover:bg-accent-soft hover:text-accent-strong`,
    });
  });
});

describe('navCaretClass', () => {
  test('caret colors', () => {
    assert({
      given: 'inactive and active items',
      should: 'use faint ink, or accent ink on the filled item',
      actual: [navCaretClass(false), navCaretClass(true)],
      expected: [
        `${caretBase} text-ink-faint`,
        `${caretBase} text-accent-strong`,
      ],
    });
  });
});
