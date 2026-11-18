import { type Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { assertNoSeriousFindings } from './support/axe';

/**
 * PYL-12: a signed-out visitor compares every plan at /pricing and can start
 * each one, at desktop and phone width, with no serious accessibility
 * finding. The browser suite runs no release-flag rows, so Club and League
 * show their closed state ("Coming soon").
 */
const widths = [
  { name: 'desktop', width: 1440, height: 1000, columns: 4 },
  { name: 'phone', width: 390, height: 844, columns: 1 },
] as const;

const card = (page: Page, name: string) =>
  page.getByRole('region', { name, exact: true });

for (const { name, width, height, columns } of widths) {
  test(`signed-out /pricing compares and starts every plan (${name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/pricing');

    await expect(page).toHaveTitle('Plans and pricing · Daisy Debate');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      /\/pricing$/,
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Plans and pricing',
    );

    const plans = ['Premium', 'Club', 'Host', 'League'];
    for (const plan of plans) await expect(card(page, plan)).toBeVisible();
    // Side by side on a desktop, stacked on a phone.
    const tops = await Promise.all(
      plans.map(async (plan) => (await card(page, plan).boundingBox())?.y),
    );
    expect(new Set(tops).size).toBe(columns === 4 ? 1 : 4);

    await expect(card(page, 'Premium')).toContainText('$20');
    await expect(card(page, 'Club')).toContainText('per seat, a month');
    await expect(card(page, 'Host')).toContainText('$199');

    const premium = card(page, 'Premium').getByRole('link', {
      name: 'Get Premium',
    });
    await expect(premium).toHaveAttribute('href', '/settings/billing');
    await expect(
      card(page, 'Host').getByRole('link', { name: 'Host a tournament' }),
    ).toHaveAttribute('href', '/host');
    await expect(card(page, 'Club')).toContainText('Coming soon');
    await expect(card(page, 'League')).toContainText('Coming soon');

    // Every action is a full-size target.
    const target = await premium.boundingBox();
    expect(target?.height ?? 0).toBeGreaterThanOrEqual(44);

    // The questions open without script and the first starts open.
    const ranked = page.locator('details', { hasText: 'Who plays ranked?' });
    await expect(
      page.getByText('There are no counters.', { exact: false }),
    ).toBeVisible();
    await expect(ranked.getByText('Youth – Freestyle')).toBeHidden();
    await ranked.locator('summary').click();
    await expect(ranked.getByText('Youth – Freestyle')).toBeVisible();

    // No horizontal scroll at either width.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await assertNoSeriousFindings(page);

    // Starting Premium signed out asks for sign-in first, then returns to billing.
    await premium.click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings%2Fbilling$/);
  });
}
