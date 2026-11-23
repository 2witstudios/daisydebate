import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import { Announcement } from '../announcement/announcement';
import { Dialog } from './dialog';
import { DialogRegion } from './dialog-region';
import type * as Client from './dialog.test-support';

setupRitewayBun();

const noop = () => {};

test('a dialog renders the platform element; a region renders the labelled shell', () => {
  const label = { 'aria-labelledby': 'title' };
  assert({
    given:
      'a closed modal, an open in-place dialog and a feature-managed overlay',
    should:
      'leave a modal’s showing to the dialog, render the in-place one open, and label the shell',
    actual: [
      renderToStaticMarkup(
        createElement(Dialog, { ...label, open: true, onClose: noop }, 'A'),
      ),
      renderToStaticMarkup(
        createElement(Dialog, {
          ...label,
          open: true,
          modal: false,
          onClose: noop,
        }),
      ),
      renderToStaticMarkup(
        createElement(DialogRegion, {
          ...label,
          as: 'section',
          'aria-modal': true,
        }),
      ),
    ],
    expected: [
      '<dialog aria-labelledby="title">A</dialog>',
      '<dialog aria-labelledby="title" open=""></dialog>',
      '<section aria-labelledby="title" aria-modal="true" role="dialog"></section>',
    ],
  });
});

test('an announcement decides its role from what it says', () => {
  assert({
    given: 'progress in a span and a problem in a paragraph',
    should: 'wait its turn for progress and interrupt for a problem',
    actual: [
      renderToStaticMarkup(
        <Announcement as="span" kind="progress">
          Saved
        </Announcement>,
      ),
      renderToStaticMarkup(
        <Announcement as="p" kind="problem">
          Try again
        </Announcement>,
      ),
    ],
    expected: [
      '<span role="status">Saved</span>',
      '<p role="alert">Try again</p>',
    ],
  });
});

test('the dialog opens, tells its owner of a close and hands focus back', async () => {
  const {
    act,
    createElement: h,
    root,
    Opened,
    browser,
  } = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./dialog.test-support', import.meta.dir),
  );
  const dialog = () =>
    browser.document.querySelector('dialog') as unknown as HTMLDialogElement;
  const press = (id: string) =>
    act(async () =>
      (browser.document.getElementById(id) as unknown as HTMLElement).click(),
    );
  const focus = (id: string) =>
    act(async () =>
      (browser.document.getElementById(id) as unknown as HTMLElement).focus(),
    );
  let closes = 0;
  await act(async () =>
    root.render(h(Opened, { closes: () => (closes += 1) })),
  );
  await focus('opener');
  await press('opener');
  const opened = dialog().open;
  await focus('inside');
  await act(async () => dialog().close());
  const after = [dialog().open, closes, browser.document.activeElement?.id];
  await focus('elsewhere');
  await press('elsewhere');
  const requested = dialog().open;
  await act(async () => root.unmount());
  assert({
    given:
      'the opener pressed, the member closing it from inside, then another control requesting it',
    should:
      'show it, tell the owner once and return focus to the opener, then open on request',
    actual: [opened, after, requested],
    expected: [true, [false, 1, 'opener'], true],
  });
});
