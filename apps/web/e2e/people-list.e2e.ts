import { expect, openPage, test } from './support/fixtures';
import { origin, resetRateLimits, signUpMember } from './support/accounts';

/**
 * The people list's forms with JavaScript off (ADR 0103). The live journeys
 * need a real realtime service, so they run in the realtime proof
 * (support/people-list-live.ts, from messaging-realtime.e2e.ts).
 */
test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

test('the people list is only for members', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  try {
    const page = await openPage(context, 'a signed-out visitor');
    await page.goto('/leaderboard');
    await expect(
      page.getByRole('complementary', { name: 'People' }),
    ).toHaveCount(0);
    const read = await context.request.get('/api/people');
    expect(read.status()).toBe(401);
  } finally {
    await context.close();
  }
});

test('a row reaches its actions with JavaScript off', async ({ browser }) => {
  test.setTimeout(90_000);
  const open = () =>
    browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
      javaScriptEnabled: false,
    });
  const [context, target] = await Promise.all([
    open(),
    browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true }),
  ]);
  try {
    await signUpMember(context.request);
    const { username } = await signUpMember(target.request);
    const page = await openPage(context, 'a member without script');
    await page.goto(`/profile/${username}`);
    await page.getByText('Challenge', { exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Send challenge' }),
    ).toBeVisible();
    await page.getByText('Report', { exact: true }).click();
    await page.getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByText('Reported.')).toBeVisible();
    await page.getByRole('button', { name: 'Block' }).click();
    await expect(page.getByText('Blocked.')).toBeVisible();
  } finally {
    await Promise.all([context.close(), target.close()]);
  }
});
