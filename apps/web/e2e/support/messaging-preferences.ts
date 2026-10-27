import { expect, type Page } from '@playwright/test';
/**
 * The selects already show the user's own choices, so only the form POST's
 * response proves the save committed before the API is read (ISSUE-518).
 */
async function submit(page: Page, channelId: string, name: string) {
  const committed = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/messages/${channelId}/preferences`,
  );
  await page.getByRole('button', { name, exact: true }).click();
  await committed;
}
/**
 * Both native DM modes exercise the same current authorized state and
 * explicit selections. The reader has already viewed the conversation, which
 * marks it read only when the browser runs JavaScript.
 */
export async function manageNativePreferences(
  page: Page,
  { channelId }: { readonly channelId: string },
  javaScriptEnabled: boolean,
) {
  await page.goto(`/messages/${channelId}/preferences`);
  await expect(
    page.getByRole('heading', { name: 'Conversation preferences' }),
  ).toBeVisible();
  await page.getByLabel('Follow this conversation').selectOption('no');
  await page.getByLabel('Hide from inbox').selectOption('no');
  await page.getByLabel('Notification preference').selectOption('none');
  await submit(page, channelId, 'Save preferences');
  await expect(page.getByLabel('Follow this conversation')).toHaveValue('no');
  await expect(page.getByLabel('Notification preference')).toHaveValue('none');
  const saved = await page.request.get(
    `/api/messaging/channels/${channelId}/preferences`,
  );
  expect(saved.status()).toBe(200);
  const result = await saved.json();
  expect(result.state.following).toBe(false);
  expect(result.state.notificationLevel).toBe('none');
  if (javaScriptEnabled)
    await expect
      .poll(
        async () =>
          (
            await (
              await page.request.get(
                `/api/messaging/channels/${channelId}/preferences`,
              )
            ).json()
          ).unread,
      )
      .toBe(0);
  else expect(result.unread).toBeGreaterThanOrEqual(1);
  await submit(page, channelId, 'Clear saved preferences');
  await expect(page.getByLabel('Follow this conversation')).toHaveValue('');
  const cleared = await page.request.get(
    `/api/messaging/channels/${channelId}/preferences`,
  );
  expect((await cleared.json()).state).toBeNull();
  await page.goto(`/messages/${channelId}`);
}
