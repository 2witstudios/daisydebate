import { expect, openPage, test } from './support/fixtures';
import { origin, resetRateLimits, signUpMember } from './support/accounts';

/**
 * The notification shell (ADR 0143, NTF-14): a friend request reaches the
 * other member's open tab without a reload, as a badge, a counted title and
 * a toast; opening the page it leads to reads it, and the badge clears.
 */
test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

test('a friend request rings the other member’s open tab, and reading it clears the badge', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const open = () =>
    browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  const [asking, answering] = await Promise.all([open(), open()]);
  try {
    const { username: askerName } = await signUpMember(asking.request);
    const { username: answererName } = await signUpMember(answering.request);
    const askerPage = await openPage(asking, 'the asking member');
    const answererPage = await openPage(answering, 'the answering member');
    const bell = answererPage
      .getByRole('navigation', { name: 'Primary' })
      .first()
      .getByRole('link', { name: /^Notifications/ });

    await answererPage.goto('/lobby');
    await expect(bell).toHaveAccessibleName('Notifications');

    await askerPage.goto('/friends');
    await askerPage.getByLabel('Username').fill(answererName);
    await askerPage
      .getByRole('button', { name: 'Send friend request' })
      .click();

    const toast = answererPage
      .getByRole('region', { name: 'New notifications' })
      .getByRole('article', { name: 'Friend request' });
    await expect(toast).toContainText(`@${askerName} wants to be friends.`);
    await expect(bell).toHaveAccessibleName('Notifications, 1 unread');
    await expect(answererPage).toHaveTitle(/^\(1\) /);

    await toast.getByRole('link', { name: 'See request' }).click();
    await expect(answererPage).toHaveURL(/\/friends$/);
    await expect(bell).toHaveAccessibleName('Notifications');
    await expect(answererPage).not.toHaveTitle(/^\(\d/);
  } finally {
    await Promise.all([asking.close(), answering.close()]);
  }
});
