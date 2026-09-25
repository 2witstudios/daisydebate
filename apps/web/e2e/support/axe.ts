import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** Fails on any serious/critical finding; moderate/minor are not gating. */
export async function assertNoSeriousFindings(page: Page) {
  // Contrast checks read real computed/rendered colors; scanning before the
  // brand webfont finishes swapping in can catch a mid-swap paint and
  // misreport a transient color, so wait for fonts to settle first.
  await page.evaluate(() => document.fonts.ready);
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter(
    (violation) =>
      violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}
