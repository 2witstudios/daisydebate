import { expect, test } from './support/fixtures';

test.describe('dashboard shell chrome', () => {
  test('the rail marks the active route and navigates from the shell', async ({
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

  test('the rail foot stays reachable on a short viewport', async ({
    page,
  }) => {
    // 200% zoom of a 1280 by 800 window: the rail is taller than the
    // viewport, so pinning it would strand its foot below it.
    await page.setViewportSize({ width: 1280, height: 400 });
    await page.goto('/');
    const signIn = page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Sign in' });
    await signIn.scrollIntoViewIfNeeded();
    await expect(signIn).toBeInViewport();
  });

  test('the rail column runs the full height of the page', async ({ page }) => {
    for (const height of [400, 900]) {
      await page.setViewportSize({ width: 1280, height });
      await page.goto('/');
      const [top, bottom, width, document] = await page
        .getByRole('navigation', { name: 'Primary' })
        .evaluate((nav) => {
          // The column is the shell grid's own child.
          const column = nav.parentElement?.getBoundingClientRect();
          return [
            column?.top ?? -1,
            (column?.bottom ?? 0) + window.scrollY,
            column?.width ?? 0,
            nav.ownerDocument.documentElement.scrollHeight,
          ];
        });
      expect([Math.round(top), Math.round(bottom), Math.round(width)]).toEqual([
        0,
        document,
        56,
      ]);
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

  test('rail flyouts reveal sub-navigation on hover and focus', async ({
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
    const rail = page.getByRole('navigation', { name: 'Primary' });
    await expect(
      rail.getByRole('link', { name: 'Daisy Debate home' }),
    ).toBeVisible();
    await expect(rail.getByRole('link', { name: 'Sign in' })).toBeVisible();
  });

  test('a phone gets a bottom tab bar in place of the rail', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const tabs = page.getByRole('navigation', { name: 'Primary' });
    // Only the tab bar is laid out: the rail is hidden, not just covered.
    await expect(tabs).toHaveCount(1);
    for (const name of ['Home', 'Play', 'Prep', 'Sign in'])
      await expect(tabs.getByRole('link', { name, exact: true })).toBeVisible();
    const bar = await tabs.boundingBox();
    expect(bar !== null && Math.round(bar.y + bar.height)).toBe(844);
    // More is a native disclosure: it opens on the sheet of everything else.
    const recordings = tabs.getByRole('link', { name: 'Recordings' });
    await expect(recordings).not.toBeVisible();
    await tabs.getByText('More', { exact: true }).click();
    await expect(recordings).toBeVisible();
    await tabs.getByRole('link', { name: 'Leaderboards' }).click();
    await expect(page).toHaveURL(/\/leaderboard$/);
    await expect(recordings).not.toBeVisible();
    // Nothing reaches past the screen's edge.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBe(0);
  });
});
