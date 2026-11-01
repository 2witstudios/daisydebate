import { expect, type Page } from '@playwright/test';
import {
  createMessagingCoreSchemas,
  messagingBetaLimits,
} from '@daisy/protocol';

export async function durableMessages(page: Page, channelId: string) {
  const response = await page.request.get(
    `/api/messaging/channels/${channelId}/messages?limit=100`,
  );
  expect(response.status()).toBe(200);
  return createMessagingCoreSchemas({
    messageUnits: messagingBetaLimits.messageUnits,
    pageItems: 100,
  }).historyResult.parse(await response.json());
}

export async function composerRequestId(page: Page) {
  return page
    .getByLabel('Your message')
    .locator('xpath=ancestor::form')
    .locator('input[name="requestId"]')
    .inputValue();
}

/** A live row is not the sending action's canonical completion barrier. */
export async function completedSend(
  page: Page,
  channelId: string,
  text: string,
  requestId: string,
) {
  const row = page
    .getByRole('list', { name: 'Message history' })
    .getByRole('listitem')
    .filter({ hasText: text });
  const edit = row.getByRole('link', {
    name: 'Edit or remove your message',
    exact: true,
  });
  await expect(edit).toBeVisible();
  const href = await edit.getAttribute('href');
  expect(href).not.toBeNull();
  const id = new URL(href!, page.url()).searchParams.get('messageId');
  expect(id).not.toBeNull();
  await expect(page).toHaveURL(
    `${new URL(page.url()).origin}/messages/${channelId}?sent=${id}`,
  );
  await expect(page.getByLabel('Your message')).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Send message', exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel('Your message')).toHaveValue('');
  expect(await composerRequestId(page)).not.toBe(requestId);
  const history = await durableMessages(page, channelId);
  const sent = history.messages.filter(
    (message) => !('unavailable' in message) && message.text === text,
  );
  expect(sent).toHaveLength(1);
  expect(sent[0]!.id).toBe(id);
  return { edit, message: sent[0]! };
}

export async function oneDurableEdit(
  page: Page,
  channelId: string,
  original: { readonly id: string; readonly changeVersion: number },
  text: string,
) {
  const history = await durableMessages(page, channelId);
  const revised = history.messages.filter(
    (message) => message.id === original.id,
  );
  expect(revised).toHaveLength(1);
  expect(revised[0]).toMatchObject({
    text,
    changeVersion: original.changeVersion + 1,
  });
  expect(revised[0]).toHaveProperty('editedAt', expect.any(String));
  expect(
    history.messages.filter(
      (message) => !('unavailable' in message) && message.text === text,
    ),
  ).toHaveLength(1);
}
