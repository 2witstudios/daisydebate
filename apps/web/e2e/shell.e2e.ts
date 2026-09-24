import { expect, test } from '@playwright/test';

test.describe('dashboard shell chrome', () => {
  test('sidebar marks the active route and navigates from the shell', async ({
    page,
  }) => {
    await page.goto('/');
    const home = page.getByRole('link', { name: 'Home', exact: true });
    await expect(home).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByRole('link', { name: 'Play / Lobby' }),
    ).not.toHaveAttribute('aria-current', 'page');

    // Play is a participant area: a visitor is sent to sign-in on the way.
    await page.getByRole('link', { name: 'Play / Lobby' }).click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fplay$/);
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
    await expect(
      page.getByRole('link', { name: 'Play / Lobby' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Play / Lobby' }).focus();
    await expect(lobby).toBeVisible();
  });

  test('interactive controls carry accessible names', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.locator('header').getByRole('link', { name: 'Sign in' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Challenge Maya Singh' }),
    ).toBeAttached();
    await expect(
      page.getByRole('img', { name: 'online' }).first(),
    ).toBeAttached();
  });

  test('the topbar offers sign-in to a visitor', async ({ page }) => {
    // ISSUE-19: on every frame from the first paint until the layout settles,
    // the topmost element at the centre of the topbar's Sign in link must be
    // that link, never a sidebar or rail layer painted over the topbar.
    await page.addInitScript(() => {
      const covered: string[] = [];
      Reflect.set(window, '__topbarCovered', covered);
      // Frames that found the link laid out: zero means nothing was checked.
      Reflect.set(window, '__topbarInspected', 0);
      const check = () => {
        const links = Array.from(document.querySelectorAll('header a')).filter(
          (link) => link.textContent?.trim() === 'Sign in',
        );
        for (const link of links) {
          const box = link.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          Reflect.set(
            window,
            '__topbarInspected',
            Number(Reflect.get(window, '__topbarInspected')) + 1,
          );
          const top = document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          );
          if (top && !link.contains(top))
            covered.push(
              `${document.readyState}: under ${top.tagName.toLowerCase()} in ${top.closest('aside, nav, main, header')?.getAttribute('aria-label') ?? 'body'}`,
            );
        }
        if (!Reflect.get(window, '__topbarSettled'))
          requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    await page.goto('/');
    const signIn = page
      .getByRole('banner')
      .getByRole('link', { name: 'Sign in' });
    await expect(signIn).toBeVisible();
    // The layout is final once every image the viewport shows has loaded;
    // lazy images below the fold never start and cannot move the topbar.
    await page.waitForFunction(() =>
      Array.from(document.images)
        .filter((image) => {
          const box = image.getBoundingClientRect();
          return box.bottom > 0 && box.top < innerHeight && box.width > 0;
        })
        .every((image) => image.complete),
    );
    await page.evaluate(() => Reflect.set(window, '__topbarSettled', true));
    const { covered, inspected } = await page.evaluate(() => ({
      covered: Reflect.get(window, '__topbarCovered') as string[],
      inspected: Number(Reflect.get(window, '__topbarInspected')),
    }));
    expect(inspected).toBeGreaterThan(0);
    expect(covered).toEqual([]);
    await signIn.click();
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});
