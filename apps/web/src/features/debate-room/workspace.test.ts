import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { WorkspaceDocument } from './documents/documents';
import {
  activateTab,
  driveDocuments,
  closeTab,
  openTab,
  loadWorkspaceDocuments,
  phonePanels,
  sidebarTabs,
  type TabsState,
} from './workspace';

setupRitewayBun();

const document = (
  id: string,
  createdAt: string,
  title = id,
): WorkspaceDocument => ({
  id,
  title,
  html: '<p></p>',
  createdAt,
  updatedAt: createdAt,
});

const early = '2026-10-05T12:00:00.000Z';
const late = '2026-10-05T12:30:00.000Z';
const docs = [
  document('b', early, 'Beta'),
  document('c', late, 'Alpha'),
  document('a', early, 'Alpha'),
];

describe('driveDocuments', () => {
  test('order', () => {
    assert({
      given: 'documents in a drive',
      should: 'sort by createdAt then title',
      actual: driveDocuments(docs).map((d) => d.id),
      expected: ['a', 'b', 'c'],
    });
  });
});

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

describe('the sidebars', () => {
  test('every Round offers the same tabs', () => {
    assert({
      given: 'the Round sidebar and a phone’s panels',
      should: 'list Transcript, Channels and AI chat, with no Round type input',
      actual: [sidebarTabs, phonePanels],
      expected: [
        ['transcript', 'channels', 'ai'],
        ['doc', 'transcript', 'channels', 'ai', 'files', 'room'],
      ],
    });
  });
});

describe('loadWorkspaceDocuments', () => {
  const empty: {
    readonly tabs: TabsState;
    readonly documents: readonly WorkspaceDocument[];
  } = { tabs: { open: [], active: null }, documents: [] };

  test('nothing open', () => {
    assert({
      given: 'a load with nothing open',
      should: 'open the document edited last',
      actual: loadWorkspaceDocuments(empty, docs).tabs,
      expected: { open: ['c'], active: 'c' },
    });
    assert({
      given: 'no documents at all',
      should: 'open nothing, so the empty state offers a new document',
      actual: loadWorkspaceDocuments(empty, []).tabs,
      expected: { open: [], active: null },
    });
  });

  test('a tab already open', () => {
    assert({
      given: 'an open tab that still exists',
      should: 'keep it',
      actual: loadWorkspaceDocuments(
        { tabs: { open: ['a'], active: 'a' }, documents: docs },
        docs,
      ).tabs,
      expected: { open: ['a'], active: 'a' },
    });
  });
});
