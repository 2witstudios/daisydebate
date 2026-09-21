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

  test('ThemeEffect writes the store theme onto <html> on the client', async ({
    page,
  }) => {
    // The server already ships data-theme="dark", so reading it back proves
    // nothing. Swap the served attribute for a sentinel (body only; original
    // status and headers are kept, so the per-response CSP nonces still
    // match). React never patches a mismatched attribute during hydration,
    // which leaves ThemeEffect -> applyTheme as the only code able to turn
    // the sentinel back into the store's theme.
    await page.route(
      (url) => url.pathname === '/',
      async (route) => {
        if (route.request().resourceType() !== 'document')
          return route.fallback();
        const response = await route.fetch();
        const html = await response.text();
        const rewritten = html.replace(
          /(<html\b[^>]*\sdata-theme=")dark(")/,
          '$1sentinel$2',
        );
        if (rewritten === html)
          throw new Error('served <html> carried no data-theme="dark"');
        await route.fulfill({ response, body: rewritten });
      },
    );
    // The rewrite must not cost a CSP violation, and the deliberate attribute
    // mismatch must not surface as a console or page error: production React
    // does not report attribute mismatches, so none is tolerated here.
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      // No favicon ships yet; headed/branded Chromium requests it and 404s.
      const source = message.location().url;
      if (URL.canParse(source) && new URL(source).pathname === '/favicon.ico')
        return;
      problems.push(message.text());
    });
    page.on('pageerror', (error) => problems.push(error.message));
    await page.addInitScript(() => {
      const seen: string[] = [];
      Reflect.set(window, '__cspViolations', seen);
      document.addEventListener('securitypolicyviolation', (event) => {
        seen.push(`${event.effectiveDirective} ${event.blockedURI}`);
      });
    });

    await page.goto('/');
    // No theme toggle exists in the UI yet, so only the initial store theme
    // ('dark') is observable; the switch path is covered by the unit test.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const violations = await page.evaluate(
      () => Reflect.get(window, '__cspViolations') as string[],
    );
    expect({ violations, problems }).toEqual({ violations: [], problems: [] });
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
