import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { PopoverDialog } from './popover-dialog';
import { PopoverMenu } from './popover-menu';

setupRitewayBun();

describe('popover primitives', () => {
  test('a dialog renders as a native auto popover', () => {
    const view = renderAccessible(
      <PopoverDialog id="d" aria-label="Fill Team 1" className="m-auto gap-2">
        Choice
      </PopoverDialog>,
    );
    assert({
      given: 'a PopoverDialog with surface classes',
      should: 'render a native auto popover dialog',
      actual: [
        view.attribute('dialog', 'Fill Team 1', 'popover'),
        view.text('dialog', 'Fill Team 1'),
      ],
      expected: ['auto', 'Choice'],
    });
  });

  test('a menu renders as a native auto popover', () => {
    const view = renderAccessible(
      <PopoverMenu id="m" aria-label="Actions" className="file-menu p-1" />,
    );
    assert({
      given: 'a PopoverMenu with placement classes',
      should: 'render a native auto popover menu',
      actual: view.attribute('menu', 'Actions', 'popover'),
      expected: 'auto',
    });
  });
});

// Compile-time: a literal display class on either primitive does not build.
// The elements are created, never rendered.
const passedThrough: { readonly className?: string | undefined } = {};
void [
  // An optional prop passes straight through, as it did to a div.
  <PopoverDialog
    key="u"
    className={passedThrough.className}
    layout={undefined}
  />,
  // @ts-expect-error a popover owns its display (SEAT-14a)
  <PopoverDialog key="d" className="m-auto flex gap-2" />,
  // @ts-expect-error a popover owns its direction
  <PopoverMenu key="m" className="file-menu flex-col" />,
];
