import { expect, test } from './support/fixtures';

test.describe('dashboard shell chrome', () => {
  test('sidebar marks the active route and navigates from the shell', async ({
    page,
  }) => {
    await page.goto('/');
    const home = page.getByRole('link', { name: 'Home', exact: true });
    await expect(home).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByRole('link', { name: 'Play', exact: true }),
    ).not.toHaveAttribute('aria-current', 'page');

    // Play is a participant area: a visitor is sent to sign-in on the way.
    await page.getByRole('link', { name: 'Play', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fplay$/);
  });

  test('the sidebar foot stays reachable on a short viewport', async ({
    page,
  }) => {
    // 200% zoom of a 1280 by 800 window: the sidebar is taller than the
    // viewport, so pinning it would strand its foot below it.
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.goto('/');
    const privacy = page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Privacy' });
    await privacy.scrollIntoViewIfNeeded();
    await expect(privacy).toBeInViewport();
  });

  test('the sidebar column runs the full height of the page', async ({
    page,
  }) => {
    for (const height of [400, 900]) {
      await page.setViewportSize({ width: 1280, height });
      await page.goto('/');
      const [column, document] = await page
        .getByRole('navigation', { name: 'Primary' })
        .evaluate((nav) => [
          // The column is the shell grid's own child.
          nav.closest('[data-dock] > *')?.getBoundingClientRect().height ?? 0,
          nav.ownerDocument.documentElement.scrollHeight,
        ]);
      expect(Math.round(column)).toBe(document);
    }
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
    await expect(recordings).not.toBeVisible();
    await page.getByRole('link', { name: 'Watch', exact: true }).focus();
    await expect(recordings).toBeVisible();
  });

  test('interactive controls carry accessible names', async ({ page }) => {
    await page.goto('/');
    await expect(
      page
        .getByRole('complementary', { name: 'Account' })
        .getByRole('link', { name: 'Sign in' }),
    ).toBeVisible();
  });
});
