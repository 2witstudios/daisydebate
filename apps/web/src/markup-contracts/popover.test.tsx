import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { PopoverDialog } from '../ui/components/popover/popover-dialog';
import { PopoverMenu } from '../ui/components/popover/popover-menu';

setupRitewayBun();

const classOf = (html: string) => /class="([^"]*)"/.exec(html)?.[1] ?? '';

/**
 * A popover owns its display: closed it is hidden and open it lays out as a
 * column, by class alone (`not-open:hidden open:flex open:flex-col`). The
 * platform popover state has no role or attribute the server render could
 * show instead, so the design-system display contract is the class list.
 */
describe('popover primitives markup', () => {
  test('a dialog renders closed as hidden and open as its layout', () => {
    const html = renderMarkup(
      <PopoverDialog id="d" aria-label="Fill Team 1" className="m-auto gap-2">
        Choice
      </PopoverDialog>,
    );
    assert({
      given: 'a PopoverDialog with surface classes',
      should: 'own its display and keep the surface classes',
      actual: classOf(html),
      expected: 'not-open:hidden open:flex open:flex-col m-auto gap-2',
    });
  });

  test('a menu renders closed as hidden and open as its layout', () => {
    const html = renderMarkup(
      <PopoverMenu id="m" aria-label="Actions" className="file-menu p-1" />,
    );
    assert({
      given: 'a PopoverMenu with placement classes',
      should: 'own its display and keep the placement classes',
      actual: classOf(html),
      expected: 'not-open:hidden open:flex open:flex-col file-menu p-1',
    });
  });

  test('a computed display class is dropped at render', () => {
    const computed: string = ['m-auto', 'flex'].join(' ');
    assert({
      given: 'a className built at runtime that sets display',
      should:
        'drop it, so the closed popover stays hidden and the page renders',
      actual: classOf(
        renderMarkup(<PopoverDialog id="x" className={computed} />),
      ),
      expected: 'not-open:hidden open:flex open:flex-col m-auto',
    });
  });
});
