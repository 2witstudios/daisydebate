import {
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test';
import { createId } from '@paralleldrive/cuid2';
import { expect, openPage, test } from './support/fixtures';
import {
  resetRateLimits,
  signUpMember,
  signUpProvisional,
} from './support/accounts';
import {
  reachExpiredLink,
  reachRetryState,
  reachSentState,
  requestConfirmLink,
} from './support/confirm-page';
import type { Theme } from './support/theme';
import { closeRoom, createFromPlay } from './support/room-launch-flow';

/** A fresh browser context pinned to one viewport and theme, with its page. */
async function themedPage(
  browser: Browser,
  baseURL: string | undefined,
  viewport: { readonly width: number; readonly height: number },
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

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
] as const;
const themes = ['dark', 'light'] as const;
// Who each screen needs: settings and the passkey offer a member, the
// username step an account that has not chosen one yet.
const routes = [
  { name: 'dashboard', path: '/', account: 'none' },
  { name: 'settings', path: '/settings', account: 'member' },
  { name: 'lobby', path: '/lobby', account: 'member' },
  {
    name: 'onboarding-username',
    path: '/onboarding/username?next=%2Flobby',
    account: 'provisional',
  },
  {
    name: 'onboarding-passkey',
    path: '/onboarding/passkey?next=%2Flobby',
    account: 'member',
  },
  {
    name: 'onboarding-welcome',
    path: '/onboarding/welcome?next=%2Flobby',
    account: 'member',
  },
  {
    name: 'onboarding-daisy',
    path: '/onboarding/daisy?next=%2Flobby',
    account: 'member',
  },
  {
    name: 'onboarding-debate',
    path: '/onboarding/debate?next=%2Flobby',
    account: 'member',
  },
  {
    name: 'onboarding-about',
    path: '/onboarding/about?next=%2Flobby',
    account: 'member',
  },
  {
    name: 'onboarding-experience',
    path: '/onboarding/experience?next=%2Flobby',
    account: 'member',
  },
  {
    name: 'onboarding-topics',
    path: '/onboarding/topics?next=%2Flobby',
    account: 'member',
  },
  {
    name: 'onboarding-ready',
    path: '/onboarding/ready?next=%2Flobby',
    account: 'member',
  },
] as const;

/**
 * Parity oracle for the Tailwind transition (ADR 0028): full-page shots of
 * the dashboard, settings, authenticated Room lobby and onboarding screens (ISSUE-77) across
 * themes and widths. The theme is pinned through the saved-preference cookie
 * (ADR 0027), motion is frozen, and the Room lobby is filtered to one real
 * Room created through the canonical Play flow. Dynamic fixture labels are
 * pinned before comparison.
 * Baselines are Linux-only; see docs/development/testing.md ("Visual
 * parity").
 */
for (const viewport of viewports) {
  for (const theme of themes) {
    for (const route of routes) {
      test(`${route.name} in ${theme} at ${viewport.name} width matches its baseline`, async ({
        browser,
        baseURL,
      }) => {
        const page = await themedPage(browser, baseURL, viewport, theme);
        const member =
          route.account === 'member'
            ? await signUpMember(page.context().request)
            : null;
        let lobbyRoomId: string | undefined;
        if (route.account === 'provisional')
          await signUpProvisional(page.context().request);
        try {
          let path: string = route.path;
          let lobbyTitle: string | undefined;
          if (route.name === 'lobby') {
            lobbyTitle = `Visual Lobby ${createId()}`;
            try {
              const room = await createFromPlay(page, lobbyTitle);
              lobbyRoomId = room.id;
            } catch (error) {
              lobbyRoomId = page.url().match(/\/rooms\/([a-z0-9]+)$/)?.[1];
              throw error;
            }
            path = `/lobby?q=${encodeURIComponent(lobbyTitle)}`;
          }
          await page.goto(path);
          if (member) {
            // Hydrated first, so React does not write the random name back.
            await page.waitForLoadState('networkidle');
            await pinDynamicText(page, member.username, 'visual-member');
          }
          if (lobbyTitle) await pinDynamicText(page, lobbyTitle, 'Visual Room');
          // The rail's avatar and the passkey offer still derive from the
          // random name, so both stay masked.
          await matchesBaseline(
            page,
            `${route.name}-${theme}-${viewport.name}.png`,
            [
              page.getByRole('link', { name: /^Account settings for/ }),
              page.getByText(/^Signed in as /),
            ],
          );
        } finally {
          try {
            if (lobbyRoomId)
              await closeRoom(page.context().request, lobbyRoomId);
          } finally {
            await page.context().close();
          }
        }
      });
    }
  }
}

/**
 * AUTH-4.7's own required widths: 1280 (desktop), 640 (200% zoom of 1280)
 * and 320 (phone reflow), each in both themes.
 */
const confirmViewports = [
  { name: '1280', width: 1280, height: 800 },
  { name: '640-200pct', width: 640, height: 400 },
  { name: '320', width: 320, height: 700 },
] as const;

type ConfirmState = 'confirm' | 'retry' | 'expired' | 'sent';
const confirmStates: readonly ConfirmState[] = [
  'confirm',
  'retry',
  'expired',
  'sent',
];

/**
 * Drives the real page to each of AUTH-4.7's four states, reusing the same
 * flows `accessibility.e2e.ts` and `csp.e2e.ts` prove behaviorally.
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
  if (state === 'retry') {
    test.slow();
    await reachRetryState(page, request, theme);
    return;
  }
  if (state === 'sent') {
    await reachSentState(page, request, theme);
    return;
  }
  await reachExpiredLink(page, request, theme);
}

for (const viewport of confirmViewports) {
  for (const theme of themes) {
    for (const state of confirmStates) {
      test(`AUTH-4.7 confirm page (${state} state) in ${theme} at ${viewport.name} width matches its baseline`, async ({
        browser,
        baseURL,
      }) => {
        const page = await themedPage(browser, baseURL, viewport, theme);
        await resetRateLimits(page.context().request);
        await prepareConfirmState(page, page.context().request, state, theme);
        await matchesBaseline(
          page,
          `confirm-${state}-${theme}-${viewport.name}.png`,
        );
        await page.context().close();
      });
    }
  }
}

const emailChangeStates = [
  { name: 'confirm', path: `/auth/confirm-email?token=${'a'.repeat(43)}` },
  { name: 'expired', path: '/auth/confirm-email?token=too-short' },
] as const;

for (const viewport of confirmViewports) {
  for (const theme of themes) {
    for (const state of emailChangeStates) {
      test(`AUTH-4.7 email-change confirm page (${state.name} state) in ${theme} at ${viewport.name} width matches its baseline`, async ({
        browser,
        baseURL,
      }) => {
        const page = await themedPage(browser, baseURL, viewport, theme);
        await page.goto(state.path);
        await matchesBaseline(
          page,
          `confirm-email-${state.name}-${theme}-${viewport.name}.png`,
        );
        await page.context().close();
      });
    }
  }
}
