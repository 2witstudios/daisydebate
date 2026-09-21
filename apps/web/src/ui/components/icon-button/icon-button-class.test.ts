import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { iconButtonClass } from './icon-button-class';

setupRitewayBun();

const base =
  'inline-flex size-8 cursor-pointer items-center justify-center rounded-sm bg-transparent text-ink-muted duration-120 ease-standard hover:bg-surface-overlay';

describe('iconButtonClass', () => {
  test('quiet brightens its own ink on hover', () => {
    assert({
      given: 'the quiet tone',
      should: 'animate colors and switch to the full ink on hover',
      actual: iconButtonClass('quiet'),
      expected: `${base} transition-colors hover:text-ink`,
    });
  });

  test('reveal lights up with its row', () => {
    assert({
      given: 'the reveal tone inside a group row',
      should:
        'start dimmed and turn accent and opaque while the row is hovered, animating both',
      actual: iconButtonClass('reveal'),
      expected: `${base} opacity-75 transition group-hover:text-accent group-hover:opacity-100`,
    });
  });
});
