import type { Locator, Page } from '@playwright/test';
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

/**
 * Every box's visible text, numbers and labels included, as laid out: any
 * text that runs past its own box or the scope's edge is reported.
 * Measuring the text, not the boxes, is what catches a number printed over
 * its neighbour, since a grid track is always inside its table. Text kept
 * for screen readers only is visually hidden and left out.
 */
export const overflowing = (scope: Locator, boxes: string): Promise<string[]> =>
  scope.evaluate((node, selector) => {
    const edge = node.getBoundingClientRect();
    const range = document.createRange();
    return [...node.querySelectorAll(selector)].flatMap((cell) => {
      const box = cell.getBoundingClientRect();
      const right = Math.min(box.right, edge.right) + 0.5;
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      const out: string[] = [];
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (text.parentElement?.closest('.sr-only')) continue;
        range.selectNodeContents(text);
        for (const rect of range.getClientRects())
          if (rect.right > right || rect.left < box.left - 0.5)
            out.push(text.textContent ?? '');
      }
      return out;
    });
  }, boxes);
