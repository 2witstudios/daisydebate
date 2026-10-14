import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { focusReturnTarget } from './focus-return';

setupRitewayBun();

const node = (name: string, drawn: boolean, holds: readonly string[] = []) => ({
  name,
  contains: (active: Node | null) =>
    holds.includes((active as unknown as { name: string } | null)?.name ?? ''),
  getClientRects: () => ({ length: drawn ? 1 : 0 }),
});

const active = (name: string) => ({ name }) as unknown as Node;

describe('focusReturnTarget', () => {
  test('a hidden region holding focus', () => {
    const toggle = node('toggle', false);
    const tab = node('tab', true);
    assert({
      given: 'focus inside the drawer it hid, the toggle hidden on a phone',
      should: 'return focus to the first target still drawn',
      actual: focusReturnTarget(
        active('file'),
        [node('drawer', false, ['file'])],
        [toggle, null, tab],
      )?.name,
      expected: 'tab',
    });
  });

  test('a region still shown', () => {
    assert({
      given: 'focus inside a drawer that is still drawn',
      should: 'leave focus where it is',
      actual: focusReturnTarget(
        active('file'),
        [node('drawer', true, ['file'])],
        [node('toggle', true)],
      ),
      expected: null,
    });
  });

  test('focus outside every region', () => {
    assert({
      given: 'focus on the toggle itself when the drawer hides',
      should: 'leave focus where it is',
      actual: focusReturnTarget(
        active('toggle'),
        [node('drawer', false, ['file']), null],
        [node('toggle', true)],
      ),
      expected: null,
    });
  });

  test('no target drawn', () => {
    assert({
      given: 'a hidden region holding focus and no target drawn',
      should: 'return no target',
      actual: focusReturnTarget(
        active('file'),
        [node('drawer', false, ['file'])],
        [node('toggle', false)],
      ),
      expected: null,
    });
  });
});
