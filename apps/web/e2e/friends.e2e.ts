import type { Browser } from '@playwright/test';
import { expect, openPage, test } from './support/fixtures';
import { origin, resetRateLimits, signUpMember } from './support/accounts';
import { expectNotInUrl } from './support/forms';

/**
 * Friendships with JavaScript off (ADR 0072; docs/development/
 * ui-conventions.md): one member asks by username, the other accepts, and
 * either removes; every step is a native form POST and no username ever
 * lands in the URL.
 */
type NoScriptContext = Awaited<ReturnType<Browser['newContext']>>;

/** Two signed-out contexts that run no script at all, closed after `work`. */
async function withTwoNoScriptContexts(
  browser: Browser,
  work: (first: NoScriptContext, second: NoScriptContext) => Promise<void>,
) {
  const open = () =>
    browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: false,
    });
  const [first, second] = await Promise.all([open(), open()]);
  try {
    await work(first, second);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
}

test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

test('two members befriend each other and part with JavaScript off', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  await withTwoNoScriptContexts(browser, async (asker, answerer) => {
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
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: false,
  });
  try {
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
  } finally {
    await context.close();
  }
});

test('a member asks from a profile with JavaScript off', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  await withTwoNoScriptContexts(browser, async (asker, other) => {
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

test('a challenge reaches the friend, who can join or decline it, with JavaScript off', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await withTwoNoScriptContexts(browser, async (challenger, friend) => {
    const { username: challengerName } = await signUpMember(challenger.request);
    const { username: friendName } = await signUpMember(friend.request);
    const asked = await challenger.request.post('/api/friends', {
      headers: { origin },
      data: { version: 1, username: friendName },
    });
    expect(asked.status()).toBe(200);
    const accepted = await friend.request.post('/api/friends/respond', {
      headers: { origin },
      data: { version: 1, username: challengerName, decision: 'accept' },
    });
    expect(accepted.status()).toBe(200);

    const challengerPage = await openPage(challenger, 'the challenger');
    await challengerPage.goto('/friends');
    await challengerPage
      .getByRole('button', { name: `Challenge @${friendName}` })
      .click();
    await expect(challengerPage).toHaveURL(/\/rooms\/[a-z0-9]{24}$/);
    const roomPath = new URL(challengerPage.url()).pathname;

    const friendPage = await openPage(friend, 'the challenged friend');
    await friendPage.goto('/friends');
    const challenges = friendPage.getByRole('region', { name: 'Challenges' });
    await expect(challenges).toContainText(`@${challengerName}`);
    await challenges
      .getByRole('link', { name: `Join @${challengerName}'s challenge` })
      .click();
    await expect(friendPage).toHaveURL(new RegExp(`${roomPath}$`));
    await friendPage.goto('/friends');
    await friendPage
      .getByRole('region', { name: 'Challenges' })
      .getByRole('button', { name: `Decline @${challengerName}'s challenge` })
      .click();
    await expect(
      friendPage.getByRole('region', { name: 'Challenges' }),
    ).toHaveCount(0);
  });
});
