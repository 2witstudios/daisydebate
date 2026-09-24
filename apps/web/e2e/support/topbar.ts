import type { Page } from '@playwright/test';

/**
 * ISSUE-19: from the first paint until `settle`, checks on every frame that
 * the topmost element at the centre of the topbar's Sign in link is that
 * link, never a sidebar or rail layer painted over the topbar. Call before
 * the navigation it should watch.
 */
export async function watchTopbarSignIn(page: Page) {
  await page.addInitScript(() => {
    const covered: string[] = [];
    Reflect.set(window, '__topbarCovered', covered);
    // Frames that found the link laid out: zero means nothing was checked.
    Reflect.set(window, '__topbarInspected', 0);
    const check = () => {
      const links = Array.from(document.querySelectorAll('header a')).filter(
        (link) => link.textContent?.trim() === 'Sign in',
      );
      for (const link of links) {
        const box = link.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        Reflect.set(
          window,
          '__topbarInspected',
          Number(Reflect.get(window, '__topbarInspected')) + 1,
        );
        const top = document.elementFromPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        if (top && !link.contains(top))
          covered.push(
            `${document.readyState}: under ${top.tagName.toLowerCase()} in ${top.closest('aside, nav, main, header')?.getAttribute('aria-label') ?? 'body'}`,
          );
      }
      if (!Reflect.get(window, '__topbarSettled')) requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  const inspected = () =>
    page.evaluate(() => Number(Reflect.get(window, '__topbarInspected')));
  /**
   * Waits until every image the viewport shows has loaded (lazy images below
   * the fold never start and cannot move the topbar) and one more frame has
   * inspected that final layout, stops watching, and reports the covered
   * frames and how many frames inspected the link.
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
    await page.waitForFunction(
      (before) => Number(Reflect.get(window, '__topbarInspected')) > before,
      await inspected(),
    );
    return page.evaluate(() => {
      Reflect.set(window, '__topbarSettled', true);
      return {
        covered: Reflect.get(window, '__topbarCovered') as string[],
        inspected: Number(Reflect.get(window, '__topbarInspected')),
      };
    });
  };
  return { settle };
}
