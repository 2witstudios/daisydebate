import { expect, type Page } from '@playwright/test';
/** Both JavaScript modes use the actual native reaction action and current summary route. */
export async function manageNativeReactions(
  page: Page,
  channelId: string,
  text: string,
) {
  const row = page
    .getByRole('list', { name: 'Message history' })
    .getByRole('listitem')
    .filter({ hasText: text });
  await row.getByRole('link', { name: 'Reactions', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Message reactions' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'React 👍', exact: true }).click();
  await expect(
    page.getByRole('list', { name: 'Current reactions' }),
  ).toContainText('👍 · 1 · You reacted');
  await expect(
    page.getByRole('button', { name: 'Remove 👍', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Remove 👍', exact: true }).click();
  await expect(
    page.getByRole('list', { name: 'Current reactions' }).getByRole('listitem'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'React 👍', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Back to conversation', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/messages/${channelId}$`));
}
