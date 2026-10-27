import {
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test';
import { expect, openPage, test } from './support/fixtures';
import {
  resetRateLimits,
  signUpBeforeAge,
  signUpMember,
} from './support/accounts';
import {
  reachExpiredLink,
  reachSentState,
  requestConfirmLink,
} from './support/confirm-page';
import type { Theme } from './support/theme';

type Viewport = {
  readonly name: string;
  readonly width: number;
  readonly height: number;
};

/** A fresh browser context pinned to one viewport and theme, with its page. */
async function themedPage(
  browser: Browser,
  baseURL: string | undefined,
  viewport: Viewport,
  theme: Theme,
): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: 'reduce',
  });
  await context.addCookies([
    { name: 'daisy-theme', value: theme, url: baseURL ?? '' },
  ]);
  return openPage(context, 'the visual page');
}

/**
 * Pins dynamic fixture strings in text and form controls before comparison.
 */
async function pinDynamicText(
  page: Page,
  source: string,
  replacement: string,
): Promise<void> {
  await page.evaluate(
    ({ name, stable }) => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        if (node.nodeValue?.includes(name))
          node.nodeValue = node.nodeValue.replaceAll(name, stable);
      for (const input of document.querySelectorAll('input'))
        if (input.value.includes(name))
          input.value = input.value.replaceAll(name, stable);
    },
    { name: source, stable: replacement },
  );
}

/** Fonts settled, then the deterministic full-page baseline comparison. */
async function matchesBaseline(
  page: Page,
  name: string,
  mask?: readonly Locator[],
): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
    ...(mask ? { mask: [...mask] } : {}),
    // Headless font antialiasing jitters a few subpixels run to run on
    // thin, low-contrast text; this absorbs that noise without hiding a
    // real color or layout regression, which moves a far larger share of
    // the frame than antialiasing jitter ever does.
    maxDiffPixelRatio: 0.02,
  });
}

const desktop = { name: 'desktop', width: 1440, height: 900 } as const;
const mobile = { name: 'mobile', width: 390, height: 844 } as const;

// The stable core (ADR 0073): surfaces that rarely change on purpose and
// where a purely visual regression would matter. Light is the default
// scheme (ADR 0069), so each surface is pinned in light at both widths and
// in dark once.
const shellFrames = [
  { theme: 'light', viewport: desktop },
  { theme: 'light', viewport: mobile },
  { theme: 'dark', viewport: desktop },
] as const;
// The signed-out app shell frame, and settings, which needs a member.
const shellScreens = [
  { name: 'dashboard', path: '/', account: 'none' },
  { name: 'settings', path: '/settings', account: 'member' },
] as const;

/**
 * Full-page shots of the app shell frame and settings. The theme is pinned
 * through the saved-preference cookie (ADR 0027), motion is frozen and the
 * member's random name is pinned before comparison. Baselines are
 * Linux-only; see docs/development/testing.md ("Visual parity").
 */
for (const screen of shellScreens) {
  for (const { theme, viewport } of shellFrames) {
    test(`${screen.name} in ${theme} at ${viewport.name} width matches its baseline`, async ({
      browser,
      baseURL,
    }) => {
      const page = await themedPage(browser, baseURL, viewport, theme);
      try {
        const member =
          screen.account === 'member'
            ? await signUpMember(page.context().request)
            : null;
        await page.goto(screen.path);
        if (member) {
          // Hydrated first, so React does not write the random name back.
          await page.waitForLoadState('networkidle');
          await pinDynamicText(page, member.username, 'visual-member');
        }
        // The rail's avatar still derives from the random name.
        await matchesBaseline(
          page,
          `${screen.name}-${theme}-${viewport.name}.png`,
          [page.getByRole('link', { name: /^Your profile, / })],
        );
      } finally {
        await page.context().close();
      }
    });
  }
}

/**
 * The age step (WAIT-4.6), the first onboarding screen every new account
 * meets: a new account signed in through the real handlers, before its
 * answer. Nothing on it is random, so nothing is pinned or masked.
 */
for (const { theme, viewport } of shellFrames) {
  test(`onboarding-age in ${theme} at ${viewport.name} width matches its baseline`, async ({
    browser,
    baseURL,
  }) => {
    const page = await themedPage(browser, baseURL, viewport, theme);
    try {
      await signUpBeforeAge(page.context().request);
      await page.goto('/onboarding/age?next=%2Flobby');
      await expect(
        page.getByRole('heading', { name: 'When were you born?' }),
      ).toBeVisible();
      await matchesBaseline(
        page,
        `onboarding-age-${theme}-${viewport.name}.png`,
      );
    } finally {
      await page.context().close();
    }
  });
}

/**
 * AUTH-4.7's required widths: 1280 (desktop), 640 (200% zoom of 1280) and
 * 320 (phone reflow).
 */
const confirm1280 = { name: '1280', width: 1280, height: 800 } as const;
const confirm640 = { name: '640-200pct', width: 640, height: 400 } as const;
const confirm320 = { name: '320', width: 320, height: 700 } as const;

type ConfirmState = 'confirm' | 'expired' | 'sent';

/**
 * Drives the real page to an AUTH-4.7 state, reusing the same flows
 * `accessibility.e2e.ts` and `csp.e2e.ts` prove behaviorally.
 */
async function prepareConfirmState(
  page: Page,
  request: APIRequestContext,
  state: ConfirmState,
  theme: Theme,
): Promise<void> {
  if (state === 'confirm') {
    const { link } = await requestConfirmLink(page, request);
    await page.goto(link);
    return;
  }
  if (state === 'sent') {
    await reachSentState(page, request, theme);
    return;
  }
  await reachExpiredLink(page, request, theme);
}

// The sign-in confirm page carries the reflow widths; its other states and
// dark each get one desktop frame.
const confirmFrames = [
  { state: 'confirm', theme: 'light', viewport: confirm1280 },
  { state: 'confirm', theme: 'light', viewport: confirm640 },
  { state: 'confirm', theme: 'light', viewport: confirm320 },
  { state: 'confirm', theme: 'dark', viewport: confirm1280 },
  { state: 'expired', theme: 'light', viewport: confirm1280 },
  { state: 'sent', theme: 'light', viewport: confirm1280 },
] as const;

for (const { state, theme, viewport } of confirmFrames) {
  test(`AUTH-4.7 confirm page (${state} state) in ${theme} at ${viewport.name} width matches its baseline`, async ({
    browser,
    baseURL,
  }) => {
    const page = await themedPage(browser, baseURL, viewport, theme);
    try {
      await resetRateLimits(page.context().request);
      await prepareConfirmState(page, page.context().request, state, theme);
      await matchesBaseline(
        page,
        `confirm-${state}-${theme}-${viewport.name}.png`,
      );
    } finally {
      await page.context().close();
    }
  });
}

test('AUTH-4.7 email-change confirm page in light at 1280 width matches its baseline', async ({
  browser,
  baseURL,
}) => {
  const page = await themedPage(browser, baseURL, confirm1280, 'light');
  try {
    await page.goto(`/auth/confirm-email?token=${'a'.repeat(43)}`);
    await matchesBaseline(page, 'confirm-email-confirm-light-1280.png');
  } finally {
    await page.context().close();
  }
});
