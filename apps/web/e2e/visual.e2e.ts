import { expect, test } from '@playwright/test';
import { signUpMember } from './support/accounts';

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
] as const;
const themes = ['dark', 'light'] as const;
const routes = [
  { name: 'dashboard', path: '/' },
  { name: 'settings', path: '/settings' },
] as const;

/**
 * Parity oracle for the Tailwind transition (ADR 0028): full-page shots of
 * the dashboard and settings across themes and widths. The theme is pinned
 * through the saved-preference cookie (ADR 0027), motion is frozen, and the
 * pages render static mock data, so the frames are deterministic. Baselines
 * are Linux-only; see docs/development/testing.md ("Visual parity").
 */
for (const viewport of viewports) {
  for (const theme of themes) {
    for (const route of routes) {
      test(`${route.name} in ${theme} at ${viewport.name} width matches its baseline`, async ({
        browser,
        baseURL,
      }) => {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          reducedMotion: 'reduce',
        });
        await context.addCookies([
          { name: 'daisy-theme', value: theme, url: baseURL ?? '' },
        ]);
        // Settings needs an account; its page shows no account details.
        if (route.path === '/settings') await signUpMember(context.request);
        const page = await context.newPage();
        await page.goto(route.path);
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(
          `${route.name}-${theme}-${viewport.name}.png`,
          { fullPage: true, animations: 'disabled', caret: 'hide' },
        );
        await context.close();
      });
    }
  }
}
