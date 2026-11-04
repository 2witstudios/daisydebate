import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  activateTab,
  closeTab,
  openTab,
  type TabsState,
} from './open-documents';

setupRitewayBun();

describe('tabs', () => {
  const tabs: TabsState = { open: ['a', 'b', 'c'], active: 'b' };

  test('openTab', () => {
    assert({
      given: 'a new document',
      should: 'append and activate it',
      actual: openTab(tabs, 'd'),
      expected: { open: ['a', 'b', 'c', 'd'], active: 'd' },
    });
    assert({
      given: 'an already open document',
      should: 'only activate it',
      actual: openTab(tabs, 'a'),
      expected: { open: ['a', 'b', 'c'], active: 'a' },
    });
  });

  test('closeTab', () => {
    assert({
      given: 'the active middle tab closed',
      should: 'activate its right neighbour',
      actual: closeTab(tabs, 'b'),
      expected: { open: ['a', 'c'], active: 'c' },
    });
    assert({
      given: 'the active last tab closed',
      should: 'activate its left neighbour',
      actual: closeTab({ ...tabs, active: 'c' }, 'c'),
      expected: { open: ['a', 'b'], active: 'b' },
    });
    assert({
      given: 'the only tab closed',
      should: 'leave nothing active',
      actual: closeTab({ open: ['a'], active: 'a' }, 'a'),
      expected: { open: [], active: null },
    });
    assert({
      given: 'an inactive tab closed',
      should: 'keep the active tab',
      actual: closeTab(tabs, 'a'),
      expected: { open: ['b', 'c'], active: 'b' },
    });
    assert({
      given: 'an unknown tab',
      should: 'return the tabs unchanged',
      actual: closeTab(tabs, 'z'),
      expected: tabs,
    });
  });

  test('activateTab', () => {
    assert({
      given: 'an open tab',
      should: 'activate it',
      actual: activateTab(tabs, 'c').active,
      expected: 'c',
    });
    assert({
      given: 'an unknown tab',
      should: 'return the tabs unchanged',
      actual: activateTab(tabs, 'z'),
      expected: tabs,
    });
  });
});
