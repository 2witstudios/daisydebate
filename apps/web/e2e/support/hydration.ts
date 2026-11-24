import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Resolves once the page has hydrated and run its mount effects, with no
 * timer and no network-idle wait. The root layout's ThemeProvider starts
 * following the theme cookie in an effect, and React runs a parent's effects
 * after its children's, so once the page applies a cookie change every
 * effect of that render has run, SessionRefresh's included. The probe is an
 * announcement on the provider's own `daisy-theme` channel, which it answers
 * by re-reading the cookie; it is repeated because a probe sent before the
 * effect is not heard. Nothing else listens there. A `visibilitychange` probe
 * also made every shell resource re-read, so the caller's next request raced
 * a burst the probe had started: on CI that burst held the whole social lane
 * and a message sent next was refused 503 (run 45309653610).
 */
export async function effectsRan(page: Page) {
  const html = page.locator('html');
  const theme = await html.getAttribute('data-theme');
  const flipped = theme === 'dark' ? 'light' : 'dark';
  await page
    .context()
    .addCookies([
      { name: 'daisy-theme', value: flipped, url: new URL(page.url()).origin },
    ]);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const announce = new BroadcastChannel('daisy-theme');
        announce.postMessage(null);
        announce.close();
        return document.documentElement.dataset['theme'];
      }),
    )
    .toBe(flipped);
}

/**
 * Resolves once React has hydrated the element `locator` finds, so a click
 * reaches its handler instead of an inert server-rendered node. React tags
 * hydrated DOM nodes with a `__reactProps$…` key. It waits as long as the
 * test allows, with no timer of its own: under load, hydration can lag the
 * first paint by seconds (ISSUE-84).
 */
export async function hydrated(locator: Locator) {
  await locator
    .page()
    .waitForFunction(
      (element) =>
        element !== null &&
        Object.keys(element).some((key) => key.startsWith('__reactProps$')),
      await locator.elementHandle(),
    );
}

/** Holds the page's scripts until `release` runs, so input lands before hydration. */
export async function holdScripts(page: Page): Promise<() => void> {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Only the scripts: the stylesheets live beside them and block painting.
  const script = (url: URL) =>
    url.pathname.startsWith('/_next/static/') && url.pathname.endsWith('.js');
  await page.route(script, async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}
