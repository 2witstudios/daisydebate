import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from '@playwright/test';
import { expect, openPage, test } from './fixtures';
import { origin, resetRateLimits, signUpMember } from './accounts';

/**
 * The connected outcome (ADR 0103): two members on different pages see each
 * other online, live, one challenges the other, ranked, and they land in the
 * same room. Then what must stop it: Busy, and a block.
 */
/** The rail, opened: a 1280px window starts it collapsed, and the choice sticks. */
const openRail = async (page: Page) => {
  const rail = page.getByRole('complementary', { name: 'People' });
  await rail.getByRole('button', { name: 'Expand people list' }).click();
  await expect(
    rail.getByRole('button', { name: 'Collapse people list' }),
  ).toBeVisible();
  return rail;
};

const twoMembers = async (browser: Browser) => {
  const open = () =>
    browser.newContext({ baseURL: origin, ignoreHTTPSErrors: true });
  const [first, second] = await Promise.all([open(), open()]);
  const [a, b] = await Promise.all([
    signUpMember(first.request),
    signUpMember(second.request),
  ]);
  return { first, second, a: a.username, b: b.username };
};

/** A ranked room needs a season, from the same worker the ranking proof uses. */
const activateSeason = () =>
  new Promise<void>((resolve, reject) =>
    execFile(
      'bun',
      [fileURLToPath(new URL('./rating-season-worker.ts', import.meta.url))],
      { timeout: 20_000 },
      (error) =>
        error ? reject(new Error('Could not activate a season')) : resolve(),
    ),
  );

export function testPeopleList() {
  test.beforeEach(async ({ request }) => {
    await resetRateLimits(request);
  });

  test('two members see each other live, challenge, accept and share a room', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    await activateSeason();
    const { first, second, a, b } = await twoMembers(browser);
    try {
      const challenger = await openPage(first, 'the challenger');
      await challenger.goto('/friends');
      const rail = await openRail(challenger);

      const challenged = await openPage(second, 'the challenged member');
      await challenged.goto('/leaderboard');

      // The second member arriving reaches the first without a reload.
      await expect(rail.getByText(`@${b}`).first()).toBeVisible({
        timeout: 45_000,
      });

      // Hover shows the card; the row itself offers no buttons.
      await rail.getByText(`@${b}`).first().hover();
      await expect(rail.getByText('Freestyle').first()).toBeVisible();

      // Right-click opens the one menu.
      await rail.getByText(`@${b}`).first().click({ button: 'right' });
      await rail
        .getByRole('button', { name: 'Challenge', exact: true })
        .click();
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
      // Both take a debater seat: the two are held for them, and nobody else's.
      const takeDebater = (page: typeof challenger) =>
        page.getByRole('button', { name: /^Take (Affirmative|Negative)/ });
      await takeDebater(challenged).first().click();
      await expect(takeDebater(challenger)).toHaveCount(1, { timeout: 30_000 });
      await takeDebater(challenger).first().click();
      await expect(takeDebater(challenger)).toHaveCount(0, { timeout: 30_000 });
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
      const rail = await openRail(viewer);
      const other = await openPage(second, 'the other member');
      await other.goto('/friends');
      await expect(rail.getByText(`@${b}`).first()).toBeVisible({
        timeout: 45_000,
      });

      // Status changes reach the other member live.
      await other
        .getByLabel(/^Your account/)
        .first()
        .click();
      await other
        .getByRole('form', { name: 'Status' })
        .first()
        .getByRole('button', { name: 'Busy' })
        .click();
      await expect(rail.getByText('Busy').first()).toBeVisible({
        timeout: 45_000,
      });
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
      expect(refused.status()).toBe(404);

      // A report is taken; a block removes them from the list.
      await rail.getByText(`@${b}`).first().click({ button: 'right' });
      await rail.getByRole('button', { name: 'Report', exact: true }).click();
      await rail.getByRole('button', { name: 'Harassment' }).click();
      await rail.getByRole('button', { name: 'Send report' }).click();
      await expect(
        rail.getByRole('button', { name: 'Reported', exact: true }),
      ).toBeDisabled();
      await rail.getByRole('button', { name: 'Block', exact: true }).click();
      await expect(rail.getByText(`@${b}`)).toHaveCount(0, { timeout: 30_000 });
      const theirs = await openRail(other);
      await expect(theirs.getByText(`@${a}`)).toHaveCount(0, {
        timeout: 45_000,
      });
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });

  test('a decline reaches the challenger, Appear offline hides, and the menu works from the keyboard', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const { first, second, a, b } = await twoMembers(browser);
    try {
      const challenger = await openPage(first, 'the challenger');
      await challenger.goto('/friends');
      const rail = await openRail(challenger);
      const challenged = await openPage(second, 'the challenged member');
      await challenged.goto('/friends');
      const row = rail.getByRole('link', { name: `Actions for @${b}` });
      await expect(row).toBeAttached({ timeout: 45_000 });

      // Keyboard: into the dialog on open, Escape closes and hands focus back.
      await row.focus();
      await challenger.keyboard.press('Enter');
      const dialog = rail.getByRole('dialog', { name: `@${b}` });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator(':focus')).toHaveCount(1);
      await challenger.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(row).toBeFocused();

      // A decline tells the challenger, wherever they are looking.
      await row.click();
      await dialog
        .getByRole('button', { name: 'Challenge', exact: true })
        .click();
      await dialog.getByRole('button', { name: 'Casual' }).click();
      await dialog.getByRole('button', { name: 'Send challenge' }).click();
      await expect(
        rail.getByRole('region', { name: `Challenge sent to @${b}` }).first(),
      ).toBeVisible();
      const card = challenged
        .getByRole('region', { name: `Challenge from @${a}` })
        .first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.getByRole('button', { name: 'Decline' }).click();
      await expect(
        rail
          .getByRole('region', { name: `Your challenge to @${b} ended` })
          .first(),
      ).toBeVisible({ timeout: 30_000 });

      // Appear offline shows them as offline, like anyone who has left.
      await challenged
        .getByLabel(/^Your account/)
        .first()
        .click();
      await challenged
        .getByRole('form', { name: 'Status' })
        .first()
        .getByRole('button', { name: 'Appear offline' })
        .click();
      // Offline sorts last, so a long list would page them out of view.
      await rail.getByLabel('Search people').fill(b);
      await expect(
        rail.getByRole('link', { name: new RegExp(`^@${b}, Offline`) }),
      ).toBeVisible({ timeout: 45_000 });

      // Someone offline can be messaged, not challenged.
      await rail.getByRole('link', { name: `Actions for @${b}` }).click();
      await expect(
        dialog.getByRole('button', { name: 'Challenge', exact: true }),
      ).toHaveCount(0);
      await expect(
        dialog.getByRole('button', { name: 'Message', exact: true }),
      ).toBeVisible();
    } finally {
      await Promise.all([first.close(), second.close()]);
    }
  });
}
