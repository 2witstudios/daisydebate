import { Window as BrowserWindow } from 'happy-dom';
import { runInNewContext } from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type * as Client from './file-delete-step.test-support';

setupRitewayBun();

const mount = async () => {
  const browser = new BrowserWindow({ url: 'https://daisy.test/' });
  const built = await Bun.build({
    entrypoints: [
      Bun.resolveSync('./file-delete-step.test-support', import.meta.dir),
    ],
    format: 'cjs',
    target: 'browser',
    define: { 'process.env.NODE_ENV': '"test"' },
  });
  if (!built.success)
    throw new Error('Delete confirmation test client failed to build');
  const client = runInNewContext(
    `${await built.outputs[0]!.text()}; module.exports;`,
    {
      window: browser,
      document: browser.document,
      navigator: browser.navigator,
      IS_REACT_ACT_ENVIRONMENT: true,
      module: { exports: {} },
      setTimeout,
      clearTimeout,
      queueMicrotask,
      console,
      MessageChannel,
      ResizeObserver: class {
        observe() {}
        disconnect() {}
      },
    },
  ) as typeof Client;
  const container = browser.document.createElement('div');
  browser.document.body.append(container);
  const root = client.createRoot(container as unknown as HTMLElement);
  return { browser, container, root, ...client };
};

test('confirm ignores repeated pointer and keyboard gestures', async () => {
  const fixture = await mount();
  const { act, createElement, root, FileDeleteStep, container, browser } =
    fixture;
  let deleted = 0;
  try {
    await act(async () =>
      root.render(
        createElement(FileDeleteStep, {
          node: { kind: 'document', id: 'a', title: 'Notes' },
          label: 'Notes',
          folderCount: async () => 1,
          change: () => {
            deleted++;
          },
          close: () => {},
          run: (action) => action(),
        }),
      ),
    );
    const confirm = container.querySelector('button')!;
    const repeated = new browser.KeyboardEvent('keydown', {
      key: 'Enter',
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      confirm.dispatchEvent(repeated);
      confirm.dispatchEvent(
        new browser.MouseEvent('click', { detail: 2, bubbles: true }),
      );
    });
    assert({
      given:
        'an auto-repeat Enter and a second pointer click from opening Delete',
      should: 'block the repeated key and never delete',
      actual: [repeated.defaultPrevented, deleted],
      expected: [true, 0],
    });
    await act(async () => {
      confirm.dispatchEvent(
        new browser.MouseEvent('click', { detail: 1, bubbles: true }),
      );
    });
    assert({
      given: 'a deliberate single confirmation click',
      should: 'perform the deletion',
      actual: deleted,
      expected: 1,
    });
  } finally {
    await act(async () => root.unmount());
    await browser.happyDOM.abort();
  }
});

test('a delayed folder count preserves the safe choice', async () => {
  const { act, createElement, root, FileDeleteStep, container, browser } =
    await mount();
  let counted!: (count: number) => void;
  const count = new Promise<number>((resolve) => {
    counted = resolve;
  });
  try {
    await act(async () =>
      root.render(
        createElement(FileDeleteStep, {
          node: {
            kind: 'folder',
            id: 'a',
            name: 'Cases',
            expanded: false,
            contents: { state: 'unread' },
          },
          label: 'Cases',
          folderCount: () => count,
          change: () => {},
          close: () => {},
          run: (action) => action(),
        }),
      ),
    );
    const keep = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Keep it',
    )!;
    keep.focus();
    await act(async () => counted(3));
    assert({
      given: 'Keep it focused when a delayed folder count arrives',
      should: 'keep that choice focused while enabling confirmation',
      actual: [
        browser.document.activeElement === keep,
        container.querySelector('button')!.disabled,
      ],
      expected: [true, false],
    });
  } finally {
    await act(async () => root.unmount());
    await browser.happyDOM.abort();
  }
});

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
        folders: [],
        recent: [],
        loadFolders: () => {},
        open: () => {},
        createDocument: () => {},
        createFolder: () => {},
        toggle: async () => true,
        folderCount: async () => 0,
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
