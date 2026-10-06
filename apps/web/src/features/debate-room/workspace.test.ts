import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { FolderId, WorkspaceDocument } from './documents';
import {
  activateTab,
  buildTree,
  closeTab,
  openTab,
  roundKindOf,
  sidebarTabs,
  visibleAgents,
  visibleChannels,
  type Agent,
  type Channel,
  type TabsState,
} from './workspace';

setupRitewayBun();

const document = (
  id: string,
  folder: FolderId,
  createdAt: string,
  title = id,
): WorkspaceDocument => ({
  id,
  title,
  folder,
  templateId: 'blank',
  html: '<p></p>',
  createdAt,
  updatedAt: createdAt,
});

const early = '2026-10-05T12:00:00.000Z';
const late = '2026-10-05T12:30:00.000Z';
const docs = [
  document('b', 'round', early, 'Beta'),
  document('c', 'round', late, 'Alpha'),
  document('a', 'round', early, 'Alpha'),
  document('l', 'library', early),
  document('k', 'club', early),
];

describe('buildTree', () => {
  test('folders and order', () => {
    const tree = buildTree(docs, 'Westside Debate');
    assert({
      given: 'a club member',
      should: 'list round, library and club folders with their titles',
      actual: tree.map((n) => [n.folder.id, n.folder.title, n.folder.shared]),
      expected: [
        ['round', 'This round', false],
        ['library', 'My library', false],
        ['club', 'Westside Debate', true],
      ],
    });
    assert({
      given: 'round documents',
      should: 'sort by createdAt then title',
      actual: tree[0]?.documents.map((d) => d.id),
      expected: ['a', 'b', 'c'],
    });
    assert({
      given: 'no club',
      should: 'omit the club folder',
      actual: buildTree(docs, null).map((n) => n.folder.id),
      expected: ['round', 'library'],
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

describe('rated rounds', () => {
  const channels: readonly Channel[] = [
    { id: 'r', title: 'Round', scope: 'round' },
    { id: 'c', title: 'Club', scope: 'club' },
  ];
  const agents: readonly Agent[] = [{ id: 'g', title: 'Coach', scope: 'club' }];

  test('sidebar visibility', () => {
    assert({
      given: 'a rated round',
      should: 'offer chat only, round channels only, and no agents',
      actual: [
        sidebarTabs('rated'),
        visibleChannels(channels, 'rated').map((c) => c.id),
        visibleAgents(agents, 'rated'),
      ],
      expected: [['chat'], ['r'], []],
    });
    assert({
      given: 'an unrated round',
      should: 'offer chat and AI with every channel and agent',
      actual: [
        sidebarTabs('unrated'),
        visibleChannels(channels, 'unrated').map((c) => c.id),
        visibleAgents(agents, 'unrated').map((a) => a.id),
      ],
      expected: [['chat', 'ai'], ['r', 'c'], ['g']],
    });
  });
});

describe('roundKindOf', () => {
  test('the room decides the round', () => {
    assert({
      given: 'a ranked room and a practice room',
      should: 'make the ranked round rated and the practice round unrated',
      actual: [roundKindOf('ranked'), roundKindOf('practice')],
      expected: ['rated', 'unrated'],
    });
  });
});
