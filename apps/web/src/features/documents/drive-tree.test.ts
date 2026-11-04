import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  addEntry,
  emptyDrive,
  folderChoices,
  moveEntry,
  removeEntry,
  renameEntry,
  withPage,
  type DriveNode,
  type DriveTree,
} from './drive-tree';

setupRitewayBun();

const page = (
  tree: DriveTree,
  folderId: string | null,
  ...entries: Parameters<typeof addEntry>[2][]
) => withPage(tree, folderId, { entries, next: null, first: true });
const folder = (id: string) => ({ kind: 'folder', id, name: id }) as const;
const doc = (id: string) => ({ kind: 'document', id, title: id }) as const;

/** a/{b/{note}}, and top at the root. */
const drive = page(
  page(page(emptyDrive, null, folder('a'), doc('top')), 'a', folder('b')),
  'b',
  doc('note'),
);
const shape = (entries: readonly DriveNode[]): unknown[] =>
  entries.map((node) =>
    node.kind === 'folder' && node.contents.state === 'read'
      ? { [node.id]: shape(node.contents.entries) }
      : node.id,
  );
const shapeOf = (tree: DriveTree) =>
  tree.contents.state === 'read' ? shape(tree.contents.entries) : 'unread';

describe('moveEntry', () => {
  test('moves a document and a folder', () => {
    assert({
      given: 'a document moved to the root, and a folder moved to the root',
      should: 'show each once, in its new place, folders first',
      actual: [
        shapeOf(moveEntry(drive, 'note', null)),
        shapeOf(moveEntry(drive, 'b', null)),
      ],
      expected: [
        [{ a: [{ b: [] }] }, 'note', 'top'],
        [{ a: [] }, { b: ['note'] }, 'top'],
      ],
    });
  });

  test('refuses what would make a cycle, and returns the same tree', () => {
    assert({
      given: 'a folder moved into itself, its child, and an unknown entry',
      should: 'return the tree it was given',
      actual: [
        moveEntry(drive, 'a', 'a') === drive,
        moveEntry(drive, 'a', 'b') === drive,
        moveEntry(drive, 'nothing', null) === drive,
      ],
      expected: [true, true, true],
    });
  });

  test('a target not yet read takes the entry when it is listed', () => {
    const tree = page(emptyDrive, null, folder('unread'), doc('d'));
    assert({
      given: 'a move into a folder this browser has not read',
      should: 'leave the source without losing the rest of the tree',
      actual: shapeOf(moveEntry(tree, 'd', 'unread')),
      expected: ['unread'],
    });
  });
});

describe('the other transitions', () => {
  test('add, rename and remove', () => {
    assert({
      given: 'a new document, a rename, and a folder removed',
      should: 'change only that entry, and the folder takes what it holds',
      actual: [
        shapeOf(addEntry(drive, 'b', doc('again'))),
        renameEntry(drive, 'top', 'Renamed').contents.state === 'read',
        shapeOf(removeEntry(drive, 'a')),
      ],
      expected: [[{ a: [{ b: ['again', 'note'] }] }, 'top'], true, ['top']],
    });
  });

  test('listing the first page again keeps later pages', () => {
    const after = { kind: 'document', label: 'b', id: 'b' } as const;
    const two = withPage(
      withPage(emptyDrive, null, {
        entries: [doc('a')],
        next: { kind: 'document', label: 'a', id: 'a' },
        first: true,
      }),
      null,
      { entries: [doc('b')], next: after, first: false },
    );
    const again = withPage(two, null, {
      entries: [doc('a')],
      next: { kind: 'document', label: 'a', id: 'a' },
      first: true,
    });
    assert({
      given: 'two pages read, then the first listed again on focus',
      should: 'keep the second page and where it resumes',
      actual: [
        shapeOf(again),
        again.contents.state === 'read' && again.contents.next,
      ],
      expected: [['a', 'b'], after],
    });
  });

  test('a row renamed elsewhere to sort earlier shows once after a relist', () => {
    const cursor = { kind: 'document', label: 'a', id: 'a' } as const;
    const two = withPage(
      withPage(emptyDrive, null, {
        entries: [doc('a')],
        next: cursor,
        first: true,
      }),
      null,
      { entries: [doc('z')], next: null, first: false },
    );
    const again = withPage(two, null, {
      entries: [doc('z')],
      next: cursor,
      first: true,
    });
    const shape0 = shapeOf(again) as readonly string[];
    assert({
      given: 'a later row that now comes back on the first page',
      should: 'list it once',
      actual: shape0.filter((id) => id === 'z').length,
      expected: 1,
    });
  });

  test('a later page extends and never repeats a row', () => {
    const first = page(emptyDrive, null, doc('a'));
    const later = withPage(first, null, {
      entries: [doc('a'), doc('b')],
      next: null,
      first: false,
    });
    assert({
      given: 'a second page overlapping the first',
      should: 'list each row once',
      actual: shapeOf(later),
      expected: ['a', 'b'],
    });
  });
});

describe('folderChoices', () => {
  const rows = [
    { id: 'a', name: 'A', parentFolderId: null },
    { id: 'b', name: 'B', parentFolderId: 'a' },
    { id: 'c', name: 'C', parentFolderId: null },
  ];
  test('lists parents before children', () => {
    assert({
      given: 'nested folders',
      should: 'order and indent them',
      actual: folderChoices(rows, null).map((one) => [one.id, one.depth]),
      expected: [
        ['a', 0],
        ['b', 1],
        ['c', 0],
      ],
    });
  });

  test('never offers a folder or its subtree for itself', () => {
    assert({
      given: 'folder a being moved',
      should: 'offer only what is outside it',
      actual: folderChoices(rows, 'a').map((one) => one.id),
      expected: ['c'],
    });
  });
});
