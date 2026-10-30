import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { resetRateLimits, signUpMember } from './support/accounts';

const desktopRail = async (page: Page) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  return page.getByRole('navigation', { name: 'Primary' });
};

const columnWidth = (rail: Locator) =>
  rail.evaluate((nav) =>
    Math.round(nav.parentElement?.getBoundingClientRect().width ?? 0),
  );

// An sr-only span retains a one-pixel box, so visibility alone is insufficient.
const wordHeight = (rail: Locator) =>
  rail
    .locator('a[href="/lobby"] span')
    .first()
    .evaluate((span) => span.getBoundingClientRect().height);

const expectRailMode = async (rail: Locator, mode: 'mini' | 'extended') => {
  await expect(
    rail.getByRole('button', { name: mode === 'mini' ? 'Expand' : 'Minimize' }),
  ).toBeVisible();
  expect(await columnWidth(rail)).toBe(mode === 'mini' ? 56 : 184);
};

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
    await expect(page).toHaveURL(/\/sign-in\?next=%2Flobby$/);
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
        184,
      ]);
    }
  });

  test('the rail defaults to extended, minimizes on request, and the choice sticks', async ({
    page,
  }) => {
    const rail = await desktopRail(page);

    // Words beside the icons at rail widths (ADR 0091).
    expect(await wordHeight(rail)).toBeGreaterThan(10);
    expect(await columnWidth(rail)).toBe(184);

    await rail.getByRole('button', { name: 'Minimize' }).click();
    await expect(rail.getByRole('button', { name: 'Expand' })).toBeVisible();
    expect(await wordHeight(rail)).toBeLessThanOrEqual(2);
    expect(await columnWidth(rail)).toBe(56);

    // The saved choice survives a visit: the server renders mini again.
    await page.reload();
    await expectRailMode(rail, 'mini');

    await rail.getByRole('button', { name: 'Expand' }).click();
    await expect(rail.getByRole('button', { name: 'Minimize' })).toBeVisible();
    expect(await wordHeight(rail)).toBeGreaterThan(10);
    expect(await columnWidth(rail)).toBe(184);
  });

  test('below the rail breakpoint it is icon-only whatever the choice', async ({
    page,
  }) => {
    const rail = await desktopRail(page);

    await expect(rail.getByRole('button', { name: 'Minimize' })).toBeVisible();

    // Narrow the viewport with the extended choice saved: CSS alone
    // keeps the rail mini and hides the toggle.
    await page.setViewportSize({ width: 1000, height: 800 });
    expect(await wordHeight(rail)).toBeLessThanOrEqual(2);
    await expect(rail.getByRole('button', { name: 'Minimize' })).toBeHidden();
    expect(await columnWidth(rail)).toBe(56);
    const play = rail.getByRole('link', { name: 'Play', exact: true });
    const box = await play.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await expect(rail.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'title',
      'Sign in',
    );

    // The saved mini choice obeys the same responsive layout.
    await page.setViewportSize({ width: 1280, height: 900 });
    await rail.getByRole('button', { name: 'Minimize' }).click();
    await expect(rail.getByRole('button', { name: 'Expand' })).toBeVisible();
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(rail.getByRole('button', { name: 'Expand' })).toBeHidden();
    expect(await columnWidth(rail)).toBe(56);
    expect((await play.boundingBox())?.width).toBeGreaterThanOrEqual(44);
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

  test('a visitor’s rail has no More control, only the way in', async ({
    page,
  }) => {
    await page.goto('/');
    // The rail is the first Primary nav; the phone tab bar, hidden here, keeps
    // its own More sheet. More now lives in the member account menu.
    const rail = page.locator('nav[aria-label="Primary"]').first();
    await expect(
      rail.getByRole('link', { name: 'More', exact: true }),
    ).toHaveCount(0);
    await expect(rail.locator('details')).toHaveCount(0);
    await expect(rail.getByRole('link', { name: 'Sign in' })).toBeVisible();
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
    for (const name of ['Home', 'Play', 'Judge', 'Sign in'])
      await expect(tabs.getByRole('link', { name, exact: true })).toBeVisible();
    const bar = await tabs.boundingBox();
    expect(bar !== null && Math.round(bar.y + bar.height)).toBe(844);
    // More is a native disclosure: it opens on the sheet of everything else.
    const terms = tabs.getByRole('link', { name: 'Terms' });
    await expect(terms).not.toBeVisible();
    await tabs.getByText('More', { exact: true }).click();
    await expect(terms).toBeVisible();
    await tabs.getByRole('link', { name: 'Help' }).click();
    await expect(page).toHaveURL(/\/help$/);
    await expect(terms).not.toBeVisible();
    // Nothing reaches past the screen's edge.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBe(0);
  });

  test('on a phone, a link brought into view stops clear of the tab bar', async ({
    page,
  }) => {
    // A short phone screen (200% zoom): the contents list runs past it.
    await page.setViewportSize({ width: 390, height: 320 });
    await page.goto('/privacy');
    const link = page.getByRole('main').getByRole('link').last();
    // Whether the tab bar, not the link, answers at the link's center.
    const covered = () =>
      link.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return hit !== null && !node.contains(hit);
      });
    // Park the link just above the screen's bottom edge, under the bar.
    await link.evaluate((node) => {
      const box = node.getBoundingClientRect();
      scrollBy(0, box.bottom - innerHeight + 8);
    });
    expect(await covered()).toBe(true);
    // Keyboard focus scrolls it into view, above the bar.
    await link.focus();
    expect(await covered()).toBe(false);
  });
});

test.describe('rail account menu', () => {
  test.beforeEach(async ({ page }) => {
    await resetRateLimits(page.request);
  });

  test('opens on the avatar, closes on an outside click or Escape, and stays open on inside clicks', async ({
    page,
  }) => {
    const { username } = await signUpMember(page.request);
    await page.goto('/');
    const rail = page.getByRole('navigation', { name: 'Primary' });
    const details = rail.locator('details');
    const summary = rail.locator(
      `summary[aria-label="Your account, ${username}"]`,
    );

    await summary.click();
    await expect(details).toHaveAttribute('open', '');

    // A click inside the menu keeps it open.
    const inside = details.locator('span').filter({ hasText: username }).last();
    await inside.click();
    await expect(details).toHaveAttribute('open', '');

    // A click elsewhere closes it.
    await page.locator('main').click();
    await expect(details).not.toHaveAttribute('open', '');

    // Reopen, then Escape closes it.
    await summary.click();
    await expect(details).toHaveAttribute('open', '');
    await page.keyboard.press('Escape');
    await expect(details).not.toHaveAttribute('open', '');
  });
});

test.describe('with JavaScript off', () => {
  test.use({ javaScriptEnabled: false });

  test('the rail toggle flips the rail through a plain POST', async ({
    page,
  }) => {
    const rail = await desktopRail(page);
    await expect(rail.getByRole('button', { name: 'Minimize' })).toBeVisible();

    // The form's server action runs without script and the answer is the
    // same page re-rendered with the flipped cookie (ADR 0091).
    await rail.getByRole('button', { name: 'Minimize' }).click();
    await expectRailMode(rail, 'mini');

    // A fresh visit (a reload here would resubmit the form POST and flip
    // the toggle a second time) renders mini from the stored cookie.
    await page.goto('/');
    await expectRailMode(rail, 'mini');

    await rail.getByRole('button', { name: 'Expand' }).click();
    await expectRailMode(rail, 'extended');
    await page.goto('/');
    await expectRailMode(rail, 'extended');
  });

  test('the account menu opens and closes as a native disclosure', async ({
    page,
  }) => {
    await resetRateLimits(page.request);
    const { username } = await signUpMember(page.request);
    await page.goto('/');
    const rail = page.getByRole('navigation', { name: 'Primary' });
    const details = rail.locator('details');
    const summary = rail.locator(
      `summary[aria-label="Your account, ${username}"]`,
    );

    await expect(details).not.toHaveAttribute('open', '');
    await summary.click();
    await expect(details).toHaveAttribute('open', '');
    await summary.click();
    await expect(details).not.toHaveAttribute('open', '');
  });
});
