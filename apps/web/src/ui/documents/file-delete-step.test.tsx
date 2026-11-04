import { mountBrowserClient } from '../test-support/browser-client.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type * as Client from './file-delete-step.test-support';

setupRitewayBun();

const mount = () =>
  mountBrowserClient<typeof Client>(
    Bun.resolveSync('./file-delete-step.test-support', import.meta.dir),
  );

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
