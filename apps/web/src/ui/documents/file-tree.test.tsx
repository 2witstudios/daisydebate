import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderToString } from 'react-dom/server';
import { emptyDrive, withPage } from '../../features/documents/drive-tree';
import { FileTree } from './file-tree';
import type { DriveActions } from './use-drive';

setupRitewayBun();

const drive: DriveActions = {
  back: '/prep',
  folders: [{ id: 'folder-a', name: 'Cases', parentFolderId: null }],
  loadFolders: () => {},
  open: () => {},
  createDocument: () => {},
  toggle: () => {},
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
const html = renderToString(
  <FileTree tree={tree} active={null} dispatch={() => {}} drive={drive} />,
);

describe('FileTree before script runs', () => {
  test('every change is a real form post that names where it returns', () => {
    const count = (text: string) => html.split(text).length - 1;
    assert({
      given: 'a folder and a document, server-rendered',
      should: 'offer each change as a POST form back to this page',
      actual: {
        rename: count('action="/api/documents/rename"'),
        folderRename: count('action="/api/documents/folders/rename"'),
        move: count('action="/api/documents/move"'),
        folderMove: count('action="/api/documents/folders/move"'),
        remove: count('action="/api/documents/delete"'),
        create: count('action="/api/documents/folders/create"'),
        back: html.includes('name="back" value="/prep"'),
        allPost: count('<form') === count('method="post"'),
      },
      expected: {
        rename: 1,
        folderRename: 1,
        move: 1,
        folderMove: 1,
        remove: 1,
        create: 1,
        back: true,
        allPost: true,
      },
    });
  });

  test('rows link where a page can answer them', () => {
    assert({
      given: 'a folder and a document',
      should: 'link the folder’s page, its deletion, and the document at Prep',
      actual: [
        html.includes('href="/prep/folders/folder-a"'),
        html.includes('href="/prep/folders/folder-a/delete"'),
        html.includes('href="/prep?open=doc-a"'),
      ],
      expected: [true, true, true],
    });
  });

  test('a folder cannot be offered as its own new parent', () => {
    const moveFolder = html.slice(
      html.indexOf('action="/api/documents/folders/move"'),
    );
    assert({
      given: 'the Move form for the folder Cases',
      should: 'not list Cases as a place to go',
      actual: moveFolder
        .slice(0, moveFolder.indexOf('</form>'))
        .includes('value="folder-a">'),
      expected: false,
    });
  });
});
