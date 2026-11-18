import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PopoverDialog } from './popover-dialog';
import { PopoverMenu } from './popover-menu';

setupRitewayBun();

const classOf = (html: string) => /class="([^"]*)"/.exec(html)?.[1] ?? '';

describe('popover primitives', () => {
  test('a dialog renders closed as hidden and open as its layout', () => {
    const html = renderToString(
      <PopoverDialog id="d" aria-label="Fill Team 1" className="m-auto gap-2">
        Choice
      </PopoverDialog>,
    );
    assert({
      given: 'a PopoverDialog with surface classes',
      should: 'render a native auto popover dialog that owns its display',
      actual: [
        html.includes('popover="auto"'),
        html.includes('role="dialog"'),
        classOf(html),
      ],
      expected: [
        true,
        true,
        'not-open:hidden open:flex open:flex-col m-auto gap-2',
      ],
    });
  });

  test('a menu renders closed as hidden and open as its layout', () => {
    const html = renderToString(
      <PopoverMenu id="m" aria-label="Actions" className="file-menu p-1" />,
    );
    assert({
      given: 'a PopoverMenu with placement classes',
      should: 'render a native auto popover menu that owns its display',
      actual: [
        html.includes('popover="auto"'),
        html.includes('role="menu"'),
        classOf(html),
      ],
      expected: [
        true,
        true,
        'not-open:hidden open:flex open:flex-col file-menu p-1',
      ],
    });
  });

  test('a computed display class is dropped at render', () => {
    const computed: string = ['m-auto', 'flex'].join(' ');
    assert({
      given: 'a className built at runtime that sets display',
      should:
        'drop it, so the closed popover stays hidden and the page renders',
      actual: classOf(
        renderToString(<PopoverDialog id="x" className={computed} />),
      ),
      expected: 'not-open:hidden open:flex open:flex-col m-auto',
    });
  });
});

// Compile-time: a literal display class on either primitive does not build.
// The elements are created, never rendered.
void [
  // @ts-expect-error a popover owns its display (SEAT-14a)
  <PopoverDialog key="d" className="m-auto flex gap-2" />,
  // @ts-expect-error a popover owns its direction
  <PopoverMenu key="m" className="file-menu flex-col" />,
];
