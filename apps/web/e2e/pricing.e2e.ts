import { type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from './support/fixtures';
import { assertNoSeriousFindings } from './support/axe';

/**
 * PYL-12: a signed-out visitor compares every plan at /pricing and can start
 * each one, at desktop and phone width, with no serious accessibility
 * finding. The page is behind `pricing-page`, which this file opens (with
 * `premium-checkout`, so Get Premium links) and closes again. The suite runs
 * one worker, so no other spec sees them open. Host (`host-tiers`) and League
 * keep their safe default and show "Coming soon". Club starts once
 * `club-seats` opens (PYL-13), so every test here sets that flag itself
 * rather than trust suite order: closed, Club is "Coming soon" and the family
 * question is absent; open, Start a Club signs a visitor in and goes on to
 * /clubs/new.
 */
const setFlag = (key: string, state: 'enabled' | 'default') =>
  promisify(execFile)(
    'bun',
    [
      fileURLToPath(
        new URL('./support/release-flag-process.ts', import.meta.url),
      ),
      key,
      state,
    ],
    { timeout: 20000, maxBuffer: 4096 },
  );
// One write at a time, so a failed write never races the cleanup's reset.
const setPricing = async (state: 'enabled' | 'default') => {
  await setFlag('pricing-page', state);
  await setFlag('premium-checkout', state);
};

test.describe.configure({ mode: 'serial' });
// Every test starts from the page open, so any one can run on its own.
test.beforeEach(async () => {
  await setPricing('enabled');
  await setFlag('club-seats', 'default');
});
test.afterAll(async () => {
  await setPricing('default');
  await setFlag('club-seats', 'default');
});

test('/pricing does not exist while its release flag is closed', async ({
  page,
}) => {
  // Only the page's own flag closes; checkout stays open, so this proves
  // the route reads pricing-page and not premium-checkout.
  await setFlag('pricing-page', 'default');
  const response = await page.goto('/pricing');
  expect(response?.status()).toBe(404);
});
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
    const boxes = await Promise.all(
      plans.map(async (plan) => {
        const box = await card(page, plan).boundingBox();
        expect(box).not.toBeNull();
        return box!;
      }),
    );
    for (const [index, box] of boxes.entries()) {
      const next = boxes[index + 1];
      if (!next) break;
      if (columns === 4) {
        // One row: shared top edge, each card wholly right of the one before.
        expect(next.y).toBe(box.y);
        expect(next.x).toBeGreaterThanOrEqual(box.x + box.width);
      } else {
        // One column: shared left edge, each card wholly below the one before.
        expect(next.x).toBe(box.x);
        expect(next.y).toBeGreaterThanOrEqual(box.y + box.height);
      }
    }

    await expect(card(page, 'Premium')).toContainText('$20');
    await expect(card(page, 'Club')).toContainText('per seat, a month');
    await expect(card(page, 'Host')).toContainText('$199');

    const premium = card(page, 'Premium').getByRole('link', {
      name: 'Get Premium',
    });
    await expect(premium).toHaveAttribute('href', '/settings/billing');
    await expect(card(page, 'Host')).toContainText('Coming soon');
    // club-seats is closed here; the test below opens it.
    await expect(card(page, 'Club')).toContainText('Coming soon');
    await expect(
      card(page, 'Club').getByRole('link', { name: 'Start a Club' }),
    ).toHaveCount(0);
    // The family answer points at Start a Club, so it waits for Club too.
    await expect(
      page.getByText('Can I buy Premium for my children?'),
    ).toHaveCount(0);
    await expect(card(page, 'League')).toContainText('Coming soon');

    // Every action is a full-size target.
    const target = await premium.boundingBox();
    expect(target?.height ?? 0).toBeGreaterThanOrEqual(44);

    // The questions are native disclosures and the first starts open.
    const ranked = page.locator('details', { hasText: 'Who plays ranked?' });
    await expect(
      page.getByText('There are no counters.', { exact: false }),
    ).toBeVisible();
    await expect(
      ranked.getByText('Youth lobby', { exact: false }),
    ).toBeHidden();
    await ranked.locator('summary').click();
    await expect(
      ranked.getByText('Youth lobby', { exact: false }),
    ).toBeVisible();

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

test('with club-seats open, signed-out Start a Club signs in, then starts a club', async ({
  page,
}) => {
  await setFlag('club-seats', 'enabled');
  await page.goto('/pricing');

  const club = card(page, 'Club');
  await expect(club).toContainText('per seat, a month');
  await expect(club).not.toContainText('Coming soon');
  const start = club.getByRole('link', { name: 'Start a Club' });
  await expect(start).toHaveAttribute('href', '/clubs/new');
  // The other plans keep their own flags: Host and League stay closed.
  await expect(card(page, 'Host')).toContainText('Coming soon');
  await expect(card(page, 'League')).toContainText('Coming soon');
  const target = await start.boundingBox();
  expect(target?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(
    page.locator('summary', { hasText: 'Can I buy Premium for my children?' }),
  ).toBeVisible();
  await assertNoSeriousFindings(page);

  await start.click();
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fclubs%2Fnew$/);
});
