import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mountBrowserClient } from '../test-support/browser-client.test-support';
import type * as Client from './file-tree.test-support';
setupRitewayBun();
const mount = () =>
  mountBrowserClient<typeof Client>(
    Bun.resolveSync('./file-tree.test-support', import.meta.dir),
  );

test('leaving rename by blur preserves the newly focused editor', async () => {
  const { act, createElement, useState, root, FileTree, container, browser } =
    await mount();
  const editor = browser.document.createElement('textarea');
  browser.document.body.append(editor);
  function Drive() {
    const [renaming, setRenaming] = useState<string | null>('a');
    return createElement(FileTree, {
      tree: {
        contents: {
          state: 'read',
          entries: [{ kind: 'document', id: 'a', title: 'Notes' }],
          next: null,
        },
      },
      active: 'a',
      renaming,
      dispatch: (action) => {
        if (action.type === 'drive/renaming') setRenaming(action.id);
      },
      drive: {
        problem: null,
        folderProblem: null,
        folders: [],
        recent: [],
        loadFolders: () => {},
        open: () => {},
        createDocument: () => {},
        createFolder: () => {},
        toggle: async () => true,
        folderCount: async () => 0,
        saveRecovered: async () => null,
        more: () => {},
        change: () => {},
      },
    });
  }
  try {
    await act(async () => root.render(createElement(Drive)));
    await act(async () => {
      container.querySelector('input')!.focus();
      editor.focus();
    });
    assert({
      given: 'a rename finished by clicking into another editor',
      should: 'leave focus in that editor',
      actual: browser.document.activeElement === editor,
      expected: true,
    });
  } finally {
    await act(async () => root.unmount());
    await browser.happyDOM.abort();
  }
});
