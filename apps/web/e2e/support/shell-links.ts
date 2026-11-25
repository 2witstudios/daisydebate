import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';

/**
 * From the first paint until `settle`, checks on every frame that the
 * topmost element at the centre of each shell link (the primary navigation)
 * named in `names` (its aria-label, else its text)
 * is that link: never a panel layer painted over the rail
 * (ISSUE-19), nor another control laid over it, as the search box once
 * covered the logo on phones (ISSUE-67).
 * Call before the navigation it should watch.
 */
export async function watchShellLinks(page: Page, names: readonly string[]) {
  await page.addInitScript((watched: readonly string[]) => {
    const covered: string[] = [];
    Reflect.set(window, '__shellCovered', covered);
    // Frames that found each link laid out: a name missing here was never
    // checked.
    const inspected: Record<string, number> = {};
    Reflect.set(window, '__shellInspected', inspected);
    const check = () => {
      const nameOf = (link: Element) =>
        link.getAttribute('aria-label') ?? link.textContent?.trim() ?? '';
      const links = Array.from(
        document.querySelectorAll('nav[aria-label="Primary"] a'),
      ).filter((link) => watched.includes(nameOf(link)));
      for (const link of links) {
        const box = link.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        inspected[nameOf(link)] = (inspected[nameOf(link)] ?? 0) + 1;
        const top = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        if (top && !link.contains(top))
          covered.push(
            `${document.readyState}: ${nameOf(link)} under ${top.tagName.toLowerCase()} in ${top.closest('aside, nav, main, header')?.getAttribute('aria-label') ?? 'body'}`,
          );
      }
      if (!Reflect.get(window, '__shellSettled')) requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }, names);
  const inspections = () =>
    page.evaluate(() =>
      Object.values(
        Reflect.get(window, '__shellInspected') as Record<string, number>,
      ).reduce((sum, count) => sum + count, 0),
    );
  /**
   * Waits until every image the viewport shows has loaded (lazy images below
   * the fold never start and cannot move the rail) and one more frame has
   * inspected that final layout, stops watching, and reports the covered
   * frames and, per watched link, how many frames inspected it.
   */
  const settle = async () => {
    await page.waitForFunction(() =>
      Array.from(document.images)
        .filter((image) => {
          const box = image.getBoundingClientRect();
          return box.bottom > 0 && box.top < innerHeight && box.width > 0;
        })
        .every((image) => image.complete),
    );
    const before = await inspections();
    await expect.poll(inspections).toBeGreaterThan(before);
    return page.evaluate(() => {
      Reflect.set(window, '__shellSettled', true);
      return {
        covered: Reflect.get(window, '__shellCovered') as string[],
        inspected: Reflect.get(window, '__shellInspected') as Record<
          string,
          number
        >,
      };
    });
  };
  return { settle };
}

/**
 * Below the `narrow` breakpoint the rail gives way to the phone's bottom
 * tabs. Read from `--breakpoint-narrow` in globals.css, its one definition.
 */
const narrowBreakpoint = (() => {
  const css = readFileSync(
    resolve(import.meta.dirname, '../../src/app/globals.css'),
    'utf8',
  );
  const px = /--breakpoint-narrow:\s*(\d+)px;/.exec(css)?.[1];
  if (!px) throw new Error('globals.css defines no --breakpoint-narrow in px');
  return Number(px);
})();

/** True when the page lays out the phone shell: bottom tabs, no logo. */
export const onPhone = (page: Page): boolean =>
  (page.viewportSize()?.width ?? narrowBreakpoint) < narrowBreakpoint;

/**
 * A member's link to their own profile: the name on their card, at the top
 * of the open people rail; in the mini rail, behind their avatar, which this
 * opens; on a phone, at the head of the More sheet, which this opens.
 */
export async function profileLink(page: Page, username: string) {
  const name = new RegExp(username);
  if (!onPhone(page)) {
    const people = page.getByRole('complementary', { name: 'People' });
    const card = people.getByRole('region', { name: 'You' });
    if (await card.isVisible()) return card.getByRole('link', { name });
    // The mini avatar opens your name and status; with no status read, it
    // is itself the link to your profile.
    const status = people
      .locator('summary[title="Your status"]')
      .filter({ visible: true });
    if ((await status.count()) === 0)
      return people
        .getByRole('link', { name: /^Your profile, / })
        .filter({ visible: true });
    await status.click();
    return people.getByRole('link', { name }).filter({ visible: true });
  }
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.locator('summary').filter({ hasText: 'More' }).click();
  return nav
    .getByRole('region', { name: 'You' })
    .getByRole('link', { name: new RegExp(username) });
}

/**
 * Opens More at the rail's foot (on a phone, the More sheet) and returns the
 * navigation that holds it.
 */
export async function openMore(page: Page) {
  const nav = page
    .getByRole('navigation', { name: 'Primary', exact: true })
    .filter({ visible: true });
  await nav.locator('summary').filter({ hasText: 'More' }).click();
  return nav;
}
