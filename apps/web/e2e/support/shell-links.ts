import { expect, type Page } from '@playwright/test';

/**
 * From the first paint until `settle`, checks on every frame that the
 * topmost element at the centre of each shell link (the primary navigation
 * and the account corner) named in `names` (its aria-label, else its text)
 * is that link: never a rail or panel layer painted over the sidebar
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
        document.querySelectorAll(
          'nav[aria-label="Primary"] a, aside[aria-label="Account"] a',
        ),
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
   * the fold never start and cannot move the sidebar) and one more frame has
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
