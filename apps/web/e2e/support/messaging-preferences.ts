import { expect, type Page } from '@playwright/test';
/** Both native DM modes exercise the same current authorized state and explicit selections. */
export async function manageNativePreferences(page: Page, channelId: string) {
  await page.goto(`/messages/${channelId}/preferences`);
  await expect(
    page.getByRole('heading', { name: 'Conversation preferences' }),
  ).toBeVisible();
  await page.getByLabel('Follow this conversation').selectOption('no');
  await page.getByLabel('Hide from inbox').selectOption('no');
  await page.getByLabel('Notification preference').selectOption('none');
  await page
    .getByRole('button', { name: 'Save preferences', exact: true })
    .click();
  await expect(page.getByLabel('Follow this conversation')).toHaveValue('no');
  await expect(page.getByLabel('Notification preference')).toHaveValue('none');
  const saved = await page.request.get(
    `/api/messaging/channels/${channelId}/preferences`,
  );
  expect(saved.status()).toBe(200);
  const result = await saved.json();
  expect(result.state.following).toBe(false);
  expect(result.state.notificationLevel).toBe('none');
  expect(result.unread).toBeGreaterThanOrEqual(1);
  await page
    .getByRole('button', { name: 'Clear saved preferences', exact: true })
    .click();
  await expect(page.getByLabel('Follow this conversation')).toHaveValue('');
  const cleared = await page.request.get(
    `/api/messaging/channels/${channelId}/preferences`,
  );
  expect((await cleared.json()).state).toBeNull();
  await page.goto(`/messages/${channelId}`);
}
