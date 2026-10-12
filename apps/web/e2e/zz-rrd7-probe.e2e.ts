import { expect, test } from './support/fixtures';
import { signUpMember } from './support/accounts';
import { gotoWithTheme } from './support/theme';

const routes = {
  library: '/prep',
  card: '/prep?view=cards&item=cost-estimates',
  brief: '/prep/briefs/rights-framework',
  newbrief: '/prep/briefs/new',
};

test('rrd7 probe', async ({ page }) => {
  test.setTimeout(240_000);
  await signUpMember(page.request);
  for (const width of [1440, 1024, 390])
    for (const theme of ['light', 'dark'] as const)
      for (const [name, route] of Object.entries(routes)) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await gotoWithTheme(page, route, theme);
        await page.waitForLoadState('networkidle');
        if (name.includes('brief')) await page.locator('.room-doc').waitFor();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        console.log(`${name} ${width} ${theme} overflow=${overflow}`);
        await page.screenshot({ path: '/private/tmp/claude-501/-Users-jono-dev-daisydebate--pu-worktrees-wt-xb6ts48u/2daff6a9-fc9d-43c1-98bd-7ae290d9eed2/scratchpad/shots/' + `${name}-${width}-${theme}.png`, fullPage: false });
      }
  await expect(page.locator('main')).toBeVisible();
});
