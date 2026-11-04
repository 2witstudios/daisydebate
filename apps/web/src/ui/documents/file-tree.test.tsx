import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderToString } from 'react-dom/server';
import { emptyDrive, withPage } from '../../features/documents/drive-tree';
import { menuPlace } from './file-menu';
import { FileTree } from './file-tree';
import type { DriveActions } from './use-drive';

setupRitewayBun();

const drive: DriveActions = {
  folders: [{ id: 'folder-a', name: 'Cases', parentFolderId: null }],
  recent: [{ id: 'doc-b', title: 'Last night' }],
  loadFolders: () => {},
  open: () => {},
  createDocument: () => {},
  createFolder: () => {},
  toggle: async () => true,
  folderCount: async () => 0,
  more: () => {},
  change: () => {},
};
const tree = withPage(emptyDrive, null, {
  entries: [
    { kind: 'folder', id: 'folder-a', name: 'Cases' },
    { kind: 'document', id: 'doc-a', title: 'Plan' },
  ],
  next: null,
  first: true,
});
const render = (renaming: string | null = null) =>
  renderToString(
    <FileTree
      tree={tree}
      active="doc-a"
      renaming={renaming}
      dispatch={() => {}}
      drive={drive}
      heading={{ title: 'Files' }}
    />,
  );

describe('FileTree', () => {
  test('the sidebar', () => {
    const html = render();
    assert({
      given: 'a heading and a drive',
      should:
        'offer one + and search, list each row, and post no forms of its own',
      actual: [
        html.includes('aria-label="New"'),
        html.includes('Search files'),
        html.includes('Cases'),
        html.includes('Plan'),
        html.includes('<form'),
      ],
      expected: [true, true, true, true, false],
    });
  });

  test('what was edited last', () => {
    const inARound = renderToString(
      <FileTree
        tree={tree}
        active={null}
        renaming={null}
        dispatch={() => {}}
        drive={drive}
      />,
    );
    assert({
      given: 'recent documents, with and without a heading of its own',
      should: 'list them in the sidebar, and leave a Round’s frame alone',
      actual: [
        render().includes('Last night'),
        inARound.includes('Last night'),
      ],
      expected: [true, false],
    });
  });

  test('a row in use', () => {
    const html = render();
    assert({
      given: 'the open document and a folder',
      should:
        'mark the document current, and give each row a flat menu with a way to delete the folder',
      actual: [
        html.includes('aria-current="page"'),
        html.includes('aria-label="Actions for Plan"'),
        html.includes('aria-label="Actions for Cases"'),
        html.includes('href="/prep/folders/folder-a/delete"'),
        html.includes('role="menuitem"'),
      ],
      expected: [true, true, true, false, true],
    });
  });

  test('a row being renamed', () => {
    const html = render('doc-a');
    assert({
      given: 'the document whose name is being typed',
      should: 'put a field in its row and hold back its menu',
      actual: [
        html.includes('aria-label="Rename Plan"'),
        html.includes('aria-label="Actions for Plan"'),
      ],
      expected: [true, false],
    });
  });
});

describe('menuPlace', () => {
  const viewport = { width: 1000, height: 800 };
  const menu = { width: 224, height: 200 };

  test('with room below', () => {
    assert({
      given: 'a button with room under it',
      should: 'open under the button',
      actual: menuPlace({ left: 100, top: 100, bottom: 128 }, menu, viewport),
      expected: { left: 100, top: 130 },
    });
  });

  test('near the screen edges', () => {
    assert({
      given: 'a button at the far corner',
      should: 'stay on screen, opening above it',
      actual: menuPlace({ left: 900, top: 760, bottom: 788 }, menu, viewport),
      expected: { left: 774, top: 558 },
    });
  });
});
