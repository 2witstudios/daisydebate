import type { Page } from '@playwright/test';
import { expect } from './fixtures';
const floor = (page: Page) =>
  page.getByRole('region', { name: 'Round floor chat', exact: true });
const message = (page: Page, text: string) =>
  floor(page)
    .getByRole('list', { name: 'Floor messages' })
    .getByRole('paragraph')
    .filter({ hasText: text });

/** Keyboard edits, reporting and removal use the real scoped actions and return focus after their answer. */
export async function proveFloorControlFocus(host: Page, peer: Page) {
  const original = 'Floor control keyboard focus';
  await floor(host)
    .getByRole('textbox', { name: 'Message debaters and host', exact: true })
    .fill(original);
  await floor(host)
    .getByRole('button', { name: 'Send message', exact: true })
    .click();
  await expect(message(peer, original)).toBeVisible();
  const own = floor(host)
    .getByRole('listitem')
    .filter({ has: host.getByRole('paragraph').filter({ hasText: original }) });
  await own.getByText('Message options', { exact: true }).click();
  let previous = original;
  for (const text of ['First keyboard edit', 'Second keyboard edit']) {
    const row = floor(host)
      .getByRole('listitem')
      .filter({
        has: host.getByRole('paragraph').filter({ hasText: previous }),
      });
    const edit = row.getByRole('textbox', {
      name: 'Edit message',
      exact: true,
    });
    await expect(edit).toHaveValue(previous);
    await edit.fill(text);
    await row.getByRole('button', { name: 'Save edit', exact: true }).focus();
    await row
      .getByRole('button', { name: 'Save edit', exact: true })
      .press('Enter');
    await expect(message(peer, text)).toBeVisible();
    await expect(
      floor(host)
        .getByRole('listitem')
        .filter({ has: host.getByRole('paragraph').filter({ hasText: text }) })
        .getByRole('textbox', { name: 'Edit message', exact: true }),
    ).toBeFocused();
    previous = text;
  }
  const report = floor(peer)
    .getByRole('listitem')
    .filter({ has: peer.getByRole('paragraph').filter({ hasText: previous }) });
  await report.getByText('Report message', { exact: true }).click();
  await report
    .getByRole('combobox', { name: 'Report reason', exact: true })
    .selectOption('spam');
  await report
    .getByRole('button', { name: 'Submit report', exact: true })
    .focus();
  await report
    .getByRole('button', { name: 'Submit report', exact: true })
    .press('Enter');
  await expect(report.getByRole('status')).toHaveText('Report received.');
  await expect(report.getByRole('status')).toBeFocused();
  const remove = floor(host)
    .getByRole('listitem')
    .filter({ has: host.getByRole('paragraph').filter({ hasText: previous }) });
  await remove
    .getByRole('combobox', { name: 'Message action', exact: true })
    .selectOption('remove');
  await remove
    .getByRole('button', { name: 'Remove message', exact: true })
    .focus();
  await remove
    .getByRole('button', { name: 'Remove message', exact: true })
    .press('Enter');
  await expect(message(host, previous)).toHaveCount(0);
  await expect(message(peer, previous)).toHaveCount(0);
  await expect(
    floor(host).getByRole('textbox', {
      name: 'Message debaters and host',
      exact: true,
    }),
  ).toBeFocused();
}
