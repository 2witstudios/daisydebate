import type { Page } from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import { channelMessagesWindow } from '@daisy/protocol';
import { expect } from './fixtures';
import { origin } from './accounts';
const floor = (page: Page) =>
  page.getByRole('region', { name: 'Round floor chat', exact: true });
const message = (page: Page, text: string) =>
  floor(page)
    .getByRole('list', { name: 'Floor messages' })
    .getByRole('paragraph')
    .filter({ hasText: text });

/** Each page comes from the protected HTTP reader, with the native projector still active. */
export async function revealFloorMessage(page: Page, text: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await message(page, text).isVisible()) return;
    const older = floor(page).getByRole('button', {
      name: 'Older messages',
      exact: true,
    });
    await expect(older).toBeVisible();
    const loaded = page.waitForResponse(
      (response) =>
        response.request().method() === 'GET' &&
        new URL(response.url()).pathname.endsWith('/floor/messages') &&
        new URL(response.url()).searchParams.has('before') &&
        response.ok(),
    );
    await older.click();
    await loaded;
    await expect(
      floor(page).getByRole('button', { name: 'Loading…', exact: true }),
    ).toHaveCount(0);
  }
  await expect(message(page, text)).toBeVisible();
}

/** A revision withdraws old protected text without destroying the caller's local edit command. */
export async function proveFloorOlderDraft({
  host,
  peer,
  roundId,
  channelId,
  ownText,
  peerText,
}: {
  readonly host: Page;
  readonly peer: Page;
  readonly roundId: string;
  readonly channelId: string;
  readonly ownText: string;
  readonly peerText: string;
}) {
  const post = async (page: Page, text: string) => {
    const response = await page.request.post(
      `/api/rounds/${roundId}/floor/messages`,
      {
        headers: { origin },
        data: { version: 1, channelId, requestId: createId(), text },
      },
    );
    expect(response.status()).toBe(200);
  };
  // Alternate real authors to stay inside each account's ordinary browser proof budget.
  for (let index = 0; index <= channelMessagesWindow.limit; index++)
    await post(
      index % 2 === 0 ? host : peer,
      `Floor pagination witness ${index}`,
    );
  await expect(
    message(host, `Floor pagination witness ${channelMessagesWindow.limit}`),
  ).toBeVisible();
  await expect(message(host, ownText)).toHaveCount(0);
  await revealFloorMessage(host, ownText);
  const row = floor(host)
    .getByRole('listitem')
    .filter({ has: host.getByRole('paragraph').filter({ hasText: ownText }) });
  await row.getByText('Message options', { exact: true }).click();
  const editor = row.getByRole('textbox', {
    name: 'Edit message',
    exact: true,
  });
  const draft = 'An older edit stays local across a newer snapshot';
  await editor.fill(draft);
  await editor.evaluate((element) =>
    element.setAttribute('data-floor-edit-witness', 'original-older-editor'),
  );
  const fieldId = await editor.getAttribute('id');
  expect(fieldId).toMatch(/^floor-edit-[a-z0-9]{24}$/);
  const field = host.locator(`textarea[id="${fieldId}"]`);
  const requestId = await field.evaluate(
    (element) =>
      (element as HTMLTextAreaElement).form?.querySelector<HTMLInputElement>(
        'input[name="requestId"]',
      )?.value,
  );
  await post(peer, 'A new revision withdraws the older page');
  await expect(
    message(host, 'A new revision withdraws the older page'),
  ).toBeVisible();
  await expect(message(host, ownText)).toHaveCount(0);
  await expect(message(host, peerText)).toHaveCount(0);
  await expect(field).toBeHidden();
  await expect(field).toHaveValue(draft);
  await expect(field).toHaveJSProperty('readOnly', true);
  await expect(field).toHaveAttribute(
    'data-floor-edit-witness',
    'original-older-editor',
  );
  expect(
    await field.evaluate(
      (element) =>
        (element as HTMLTextAreaElement).form?.querySelector<HTMLInputElement>(
          'input[name="requestId"]',
        )?.value,
    ),
  ).toBe(requestId);
  await revealFloorMessage(host, ownText);
  await expect(field).toBeVisible();
  await expect(field).toBeEditable();
  await expect(field).toHaveValue(draft);
  await expect(field).toHaveAttribute(
    'data-floor-edit-witness',
    'original-older-editor',
  );
  expect(
    await field.evaluate(
      (element) =>
        (element as HTMLTextAreaElement).form?.querySelector<HTMLInputElement>(
          'input[name="requestId"]',
        )?.value,
    ),
  ).toBe(requestId);
  const save = floor(host)
    .getByRole('listitem')
    .filter({ has: host.getByRole('paragraph').filter({ hasText: ownText }) })
    .getByRole('button', { name: 'Save edit', exact: true });
  await save.focus();
  await save.press('Enter');
  await expect(
    floor(host).getByRole('textbox', {
      name: 'Message debaters and host',
      exact: true,
    }),
  ).toBeFocused();
  await revealFloorMessage(host, draft);
  await expect(message(host, draft)).toBeVisible();
  return draft;
}
