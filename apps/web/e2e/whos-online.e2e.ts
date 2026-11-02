import { expect, openPage, test } from './support/fixtures';
import { origin, resetRateLimits, signUpMember } from './support/accounts';

/**
 * The connected outcome (ADR 0097): two members on different pages see each
 * other online, live, one challenges the other, ranked, and they land in the
 * same room. Then the things that must stop it: Busy, and a block.
 */
test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

const twoMembers = async (browser: import('@playwright/test').Browser) => {
  const open = () =>
    browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  const [first, second] = await Promise.all([open(), open()]);
  const [a, b] = await Promise.all([
    signUpMember(first.request),
    signUpMember(second.request),
  ]);
  return { first, second, a: a.username, b: b.username };
};

test('two members see each other live, challenge, accept and share a room', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { first, second, a, b } = await twoMembers(browser);
  try {
    const challenger = await openPage(first, 'the challenger');
    await challenger.goto('/friends');
    const rail = challenger.getByRole('complementary', { name: "Who's online" });
    await expect(rail).toBeVisible();

    const challenged = await openPage(second, 'the challenged member');
    await challenged.goto('/leaderboard');

    // The second member arriving reaches the first without a reload.
    await expect(rail.getByText(`@${b}`).first()).toBeVisible({ timeout: 45_000 });

    // Hover shows the card; the row itself offers no buttons.
    await rail.getByText(`@${b}`).first().hover();
    await expect(rail.getByText('Freestyle').first()).toBeVisible();

    // Right-click opens the one menu.
    await rail.getByText(`@${b}`).first().click({ button: 'right' });
    await rail.getByRole('menuitem', { name: 'Challenge' }).click();
    await rail.getByRole('button', { name: 'Send challenge' }).click();
    await expect(rail.getByText('Challenge sent').first()).toBeVisible();

    // It reaches the other member on a page that has nothing to do with it.
    const card = challenged
      .getByRole('region', { name: `Challenge from @${a}` })
      .first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText('Freestyle · Ranked');
    await card.getByRole('button', { name: 'Accept' }).click();

    await expect(challenged).toHaveURL(/\/rooms\/[a-z0-9]{24}$/, {
      timeout: 30_000,
    });
    const room = new URL(challenged.url()).pathname;
    // The challenger follows, without touching anything.
    await expect(challenger).toHaveURL(new RegExp(`${room}$`), {
      timeout: 45_000,
    });
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});

test('Busy refuses a challenge, and a block hides each from the other', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { first, second, a, b } = await twoMembers(browser);
  try {
    const viewer = await openPage(first, 'the viewer');
    await viewer.goto('/friends');
    const rail = viewer.getByRole('complementary', { name: "Who's online" });
    const other = await openPage(second, 'the other member');
    await other.goto('/friends');
    await expect(rail.getByText(`@${b}`).first()).toBeVisible({ timeout: 45_000 });

    // Status changes reach the other member live.
    await other.getByLabel(/^Your account/).first().click();
    await other
      .getByRole('form', { name: 'Status' })
      .first()
      .getByRole('button', { name: 'Busy' })
      .click();
    await expect(rail.getByText('Busy').first()).toBeVisible({ timeout: 45_000 });
    const refused = await first.request.post('/api/challenges', {
      headers: { origin },
      data: {
        version: 1,
        commandId: 'x'.repeat(24),
        username: b,
        mode: 'casual',
        format: 'freestyle',
      },
    });
    expect(refused.status()).toBe(409);

    // A report is taken; a block removes them from the list.
    await rail.getByText(`@${b}`).first().click({ button: 'right' });
    await rail.getByRole('menuitem', { name: 'Report' }).click();
    await rail.getByRole('button', { name: 'Harassment' }).click();
    await rail.getByRole('button', { name: 'Send report' }).click();
    await expect(rail.getByRole('menuitem', { name: 'Reported' })).toBeDisabled();
    await rail.getByRole('menuitem', { name: 'Block' }).click();
    await expect(rail.getByText(`@${b}`)).toHaveCount(0, { timeout: 30_000 });
    const theirs = other.getByRole('complementary', { name: "Who's online" });
    await expect(theirs.getByText(`@${a}`)).toHaveCount(0, { timeout: 45_000 });
  } finally {
    await Promise.all([first.close(), second.close()]);
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
    await expect(page.getByRole('button', { name: 'Send challenge' })).toBeAttached();
    await page.getByText('Report', { exact: true }).click();
    await page.getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByText('Reported.')).toBeVisible();
    await page.getByRole('button', { name: 'Block' }).click();
    await expect(page.getByText('Blocked.')).toBeVisible();
  } finally {
    await Promise.all([context.close(), target.close()]);
  }
});
