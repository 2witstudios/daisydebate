import { createElement, type ReactNode } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { mountBrowserClient } from '../../test-support/browser-client.test-support';
import { Announcement } from '../announcement/announcement';
import { Dialog } from './dialog';
import { DialogRegion } from './dialog-region';
import type * as Client from './dialog.test-support';

setupRitewayBun();

const noop = () => {};

test('a dialog renders the platform element; a region renders the labelled shell', () => {
  const label = { 'aria-labelledby': 'title' };
  const titled = (dialog: ReactNode) =>
    renderAccessible(
      createElement(
        'div',
        null,
        createElement('h2', { id: 'title' }, 'Report'),
        dialog,
      ),
    );
  const modal = titled(
    createElement(Dialog, { ...label, open: true, onClose: noop }, 'A'),
  );
  // A closed dialog is out of the tree until shown: absent, yet named.
  const closedModal = [
    modal.count('dialog'),
    modal.text('dialog', 'Report', { hidden: true }),
  ];
  const inPlace = titled(
    createElement(Dialog, {
      ...label,
      open: true,
      modal: false,
      onClose: noop,
    }),
  ).attribute('dialog', 'Report', 'open');
  const region = titled(
    createElement(DialogRegion, {
      ...label,
      as: 'section',
      'aria-modal': true,
    }),
  );
  assert({
    given:
      'a closed modal, an open in-place dialog and a feature-managed overlay',
    should:
      'leave a modal’s showing to the dialog, render the in-place one open, and label the shell',
    actual: [
      closedModal,
      inPlace,
      [
        region.get('dialog', 'Report').tagName,
        region.attribute('dialog', 'Report', 'aria-modal'),
      ],
    ],
    expected: [[0, 'A'], '', ['SECTION', 'true']],
  });
});

test('an announcement decides its role from what it says', () => {
  const progress = renderAccessible(
    <Announcement as="span" kind="progress">
      Saved
    </Announcement>,
  );
  const saved = [progress.get('status').tagName, progress.text('status')];
  const problem = renderAccessible(
    <Announcement as="p" kind="problem">
      Try again
    </Announcement>,
  );
  assert({
    given: 'progress in a span and a problem in a paragraph',
    should: 'wait its turn for progress and interrupt for a problem',
    actual: [saved, [problem.get('alert').tagName, problem.text('alert')]],
    expected: [
      ['SPAN', 'Saved'],
      ['P', 'Try again'],
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

test('an in-place dialog shown on arrival hands focus to its trigger on Escape and on close', async () => {
  const {
    act,
    createElement: h,
    root,
    ShownOnArrival,
    browser,
  } = await mountBrowserClient<typeof Client>(
    Bun.resolveSync('./dialog.test-support', import.meta.dir),
  );
  const byId = (id: string) =>
    browser.document.getElementById(id) as unknown as HTMLElement;
  let closes = 0;
  await act(async () =>
    root.render(h(ShownOnArrival, { closes: () => (closes += 1) })),
  );
  const shown = browser.document.querySelector('dialog')?.hasAttribute('open');
  await act(async () => byId('stay').focus());
  await act(async () =>
    byId('stay').dispatchEvent(
      new browser.KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }) as unknown as Event,
    ),
  );
  const afterEscape = [closes, browser.document.activeElement?.id];
  await act(async () => byId('trigger').click());
  await act(async () => byId('stay').click());
  const afterStay = browser.document.activeElement?.id;
  await act(async () => root.unmount());
  assert({
    given:
      'a confirm rendered open with nothing focused, closed by Escape, then reopened and closed by Stay',
    should:
      'tell the owner of the Escape and return focus to the trigger each time',
    actual: [shown, afterEscape, afterStay],
    expected: [true, [1, 'trigger'], 'trigger'],
  });
});
