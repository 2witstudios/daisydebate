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

    await page.getByRole('link', { name: 'Play / Lobby' }).click();
    await expect(page).toHaveURL(/\/play$/);
  });

  test('the search input round-trips through the shell state', async ({
    page,
  }) => {
    await page.goto('/');
    const search = page.getByRole('searchbox', { name: 'Search' });
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
    await expect(page).toHaveURL(/\/recordings$/);

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
      page.locator('header').getByRole('button', { name: /Alex Chen/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Challenge Maya Singh' }),
    ).toBeAttached();
    await expect(
      page.getByRole('status', { name: 'online' }).first(),
    ).toBeAttached();
  });
});
