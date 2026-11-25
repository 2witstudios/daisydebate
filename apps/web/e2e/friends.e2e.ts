import type { Browser } from '@playwright/test';
import { expect, openPage, test } from './support/fixtures';
import { origin, resetRateLimits, signUpMember } from './support/accounts';
import { expectNotInUrl } from './support/forms';

/**
 * Friendships (ADR 0072): one member asks by username, the other accepts,
 * and either removes; no username ever lands in the URL.
 */
type MemberContext = Awaited<ReturnType<Browser['newContext']>>;

/** Two signed-out contexts, closed after `work`. */
async function withTwoContexts(
  browser: Browser,
  work: (first: MemberContext, second: MemberContext) => Promise<void>,
) {
  const open = () =>
    browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
  const [first, second] = await Promise.all([open(), open()]);
  try {
    await work(first, second);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
}

/** One signed-out context, closed after `work`. */
async function withContext(
  browser: Browser,
  work: (context: MemberContext) => Promise<void>,
) {
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  try {
    await work(context);
  } finally {
    await context.close();
  }
}

test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

test('two members befriend each other and part', async ({ browser }) => {
  test.setTimeout(90_000);
  await withTwoContexts(browser, async (asker, answerer) => {
    const { username: askerName } = await signUpMember(asker.request);
    const { username: answererName } = await signUpMember(answerer.request);
    const askerPage = await openPage(asker, 'the asking member');
    const answererPage = await openPage(answerer, 'the answering member');

    await askerPage.goto('/friends');
    await expect(
      askerPage.getByText('Add a friend by username', { exact: false }),
    ).toBeVisible();
    await askerPage.getByLabel('Username').fill(answererName);
    await askerPage
      .getByRole('button', { name: 'Send friend request' })
      .click();
    await expect(askerPage.locator('#add-friend-notice')).toContainText(
      `Friend request sent to @${answererName}.`,
    );
    expectNotInUrl(askerPage, answererName);
    await expect(
      askerPage.getByRole('button', { name: `Cancel @${answererName}` }),
    ).toBeVisible();

    await answererPage.goto('/friends');
    await answererPage
      .getByRole('button', { name: `Accept @${askerName}` })
      .click();
    await expect(
      answererPage.getByRole('button', { name: `Remove @${askerName}` }),
    ).toBeVisible();
    expectNotInUrl(answererPage, askerName);

    await askerPage.goto('/friends');
    await expect(
      askerPage.getByRole('region', { name: 'Your friends' }),
    ).toContainText(`@${answererName}`);
    await askerPage
      .getByRole('button', { name: `Remove @${answererName}` })
      .click();
    await expect(
      askerPage.getByRole('region', { name: 'Your friends' }),
    ).toHaveCount(0);
  });
});

test('an unknown username is refused with the name kept', async ({
  browser,
}) => {
  await withContext(browser, async (context) => {
    await signUpMember(context.request);
    const page = await openPage(context, 'a member adding nobody');
    await page.goto('/friends');
    await page.getByLabel('Username').fill('nobody-by-this-name');
    await page.getByRole('button', { name: 'Send friend request' }).click();
    await expect(page.locator('#add-friend-notice')).toContainText(
      'No member with that username can take a friend request from you.',
    );
    await expect(page.getByLabel('Username')).toHaveValue(
      'nobody-by-this-name',
    );
    expectNotInUrl(page, 'nobody-by-this-name');
  });
});

test('a member asks from a profile', async ({ browser }) => {
  test.setTimeout(90_000);
  await withTwoContexts(browser, async (asker, other) => {
    await signUpMember(asker.request);
    const { username } = await signUpMember(other.request);
    const page = await openPage(asker, 'a member on a profile');
    await page.goto(`/profile/${username}`);
    await page.getByRole('button', { name: `Add friend @${username}` }).click();
    await expect(
      page.getByRole('button', { name: `Cancel friend request @${username}` }),
    ).toBeVisible();
  });
});

test('a member sets their status from their card', async ({ browser }) => {
  await withContext(browser, async (context) => {
    await signUpMember(context.request);
    const page = await openPage(context, 'a member choosing their status');
    await page.goto('/friends');
    await page
      .getByLabel('Your status', { exact: true })
      .filter({ visible: true })
      .click();
    const status = page
      .getByRole('form', { name: 'Status' })
      .filter({ visible: true });
    await status.getByRole('button', { name: 'Busy' }).click();
    await expect(status.getByRole('button', { name: 'Busy' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.goto('/friends');
    await page
      .getByLabel('Your status', { exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page
        .getByRole('form', { name: 'Status' })
        .filter({ visible: true })
        .getByRole('button', { name: 'Busy' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});
