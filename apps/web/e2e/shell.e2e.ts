import { expect, test } from '@playwright/test';

test.describe('dashboard shell chrome', () => {
  test('sidebar marks the active route and navigates from the shell', async ({
    page,
  }) => {
    await page.goto('/');
    const home = page.getByRole('link', { name: 'Home' });
    await expect(home).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByRole('link', { name: 'Play / Lobby' }),
    ).not.toHaveAttribute('aria-current', 'page');

    // Play is a participant area: a visitor is sent to sign-in on the way.
    await page.getByRole('link', { name: 'Play / Lobby' }).click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fplay$/);
  });

  test('the search input round-trips through the shell state', async ({
    page,
  }) => {
    await page.goto('/');
    const search = page.getByRole('searchbox', { name: 'Search' });
    // Hydration gate, not a behavior proof: nothing else in the UI renders
    // the search query today, and fill + toHaveValue also pass on the inert
    // server-rendered input. React tags hydrated DOM nodes with a
    // `__reactProps$…` key, so waiting for it makes this test fail when the
    // client shell never attaches.
    await page.waitForFunction(
      (input) =>
        input !== null &&
        Object.keys(input).some((key) => key.startsWith('__reactProps$')),
      await search.elementHandle(),
    );
    await search.fill('climate');
    await expect(search).toHaveValue('climate');
  });

  test('menu tiles share one uniform shape', async ({ page }) => {
    await page.goto('/');
    const grid = page.getByRole('list', { name: 'Debate destinations' });
    await expect(grid.locator('li > a')).toHaveCount(8);
    const tileWidths = await grid
      .locator('li > a')
      .evaluateAll((links) =>
        links.map((link) => link.getBoundingClientRect().width),
      );
    const spread = Math.max(...tileWidths) - Math.min(...tileWidths);
    expect(tileWidths.length).toBe(8);
    expect(spread).toBeLessThanOrEqual(1);
  });

  test('sidebar flyouts reveal sub-navigation on hover and focus', async ({
    page,
  }) => {
    await page.goto('/');
    // Hidden flyout links are outside the accessibility tree until revealed,
    // so the hidden state is asserted with a structural locator.
    const recordings = page.locator(
      'nav[aria-label="Primary"] a[href="/recordings"]',
    );
    await expect(recordings).toBeAttached();
    await expect(recordings).not.toBeVisible();

    await page.getByRole('link', { name: 'Watch', exact: true }).hover();
    await expect(recordings).toBeVisible();

    // Paint order: the hero must not cover the revealed flyout.
    const covered = await recordings.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
      return hit !== el && !el.contains(hit);
    });
    expect(covered).toBe(false);

    await recordings.click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Frecordings$/);

    // Keyboard: focusing the parent link opens the flyout via :focus-within.
    await page.goto('/');
    const lobby = page.locator('nav[aria-label="Primary"] a[href="/lobby"]');
    await expect(lobby).not.toBeVisible();
    await page.getByRole('link', { name: 'Play / Lobby' }).focus();
    await expect(lobby).toBeVisible();
  });

  test('interactive controls carry accessible names', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.getByRole('button', { name: 'Notifications' }),
    ).toBeVisible();
    await expect(
      page.locator('header').getByRole('link', { name: 'Sign in' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Challenge Maya Singh' }),
    ).toBeAttached();
    await expect(
      page.getByRole('status', { name: 'online' }).first(),
    ).toBeAttached();
  });

  // Desktop-only: at narrow widths the topbar's notification bell overlaps
  // the wrapped "Sign in" link and intercepts the click (AUTH-6.6 found
  // this running the auth-journey specs on mobile projects). That is a
  // real app-shell layout defect outside this leaf's auth-screen scope;
  // this test stays on the desktop-only Chromium project and the overlap
  // is tracked as a follow-up for the app-shell/topbar owner.
  test('the topbar offers sign-in to a visitor', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
