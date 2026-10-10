import { openPage } from './fixtures';
import { expect, type Page, type BrowserContext } from '@playwright/test';
/** Both native modes edit a fresh own contribution, then remove it while posting is blocked. */
export async function editNativeMessage(page: Page, channelId: string) {
  const original = 'Temporary native cleanup contribution';
  const edited = 'Revised native cleanup contribution';
  await page.getByLabel('Your message').fill(original);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const row = page
    .getByRole('list', { name: 'Message history' })
    .getByRole('listitem')
    .filter({ hasText: original });
  await row
    .getByRole('link', { name: 'Edit or remove your message', exact: true })
    .click();
  await page.getByLabel('Revise your message').fill(edited);
  await page
    .getByRole('button', { name: 'Save message edit', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/messages/${channelId}$`));
  const updated = page
    .getByRole('list', { name: 'Message history' })
    .getByRole('listitem')
    .filter({ hasText: edited });
  await expect(updated).toHaveCount(1);
  await expect(messageInHistory(page, edited)).toHaveCount(1);
  await expect(updated).toContainText('edited');
  await expect(row).toHaveCount(0);
  const path = await updated
    .getByRole('link', { name: 'Edit or remove your message', exact: true })
    .getAttribute('href');
  if (path === null) throw new Error('Actual own message controls required');
  return { path, text: edited };
}
export async function removeNativeMessage(
  context: BrowserContext,
  channelId: string,
  message: { readonly path: string; readonly text: string },
) {
  const page = await openPage(
    context,
    'own-message cleanup while posting is blocked',
  );
  try {
    await page.goto(message.path);
    await page
      .getByRole('button', { name: 'Remove your message', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/messages/${channelId}$`));
    const history = page.getByRole('list', { name: 'Message history' });
    await expect(history.getByText(message.text, { exact: true })).toHaveCount(
      0,
    );
    await expect(history).toContainText('Message unavailable');
  } finally {
    await page.close();
  }
}

export function messageInHistory(page: Page, text: string) {
  return page
    .getByRole('list', { name: 'Message history' })
    .getByText(text, { exact: true });
}
