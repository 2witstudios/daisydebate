import * as playwright from '@playwright/test';
import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { boundedStep } from './bounded-step';

/**
 * Per-test browser diagnostics for every spec (ISSUE-234, ISSUE-253): each
 * watched page's console messages and uncaught errors, and every CDP
 * WebAuthn event and ceremony marker recorded through `recordDiagnostic`.
 * A failed test writes them to `browser-diagnostics.log` in its output
 * folder, beside the trace, so a stalled create() or get() shows whether
 * the page never called it, called it and heard nothing back, or the
 * authenticator answered and the page stopped. `bun verify` archives that
 * folder with the rest of test-results.
 */
const lines: string[] = [];
let started = 0;
const labels = new WeakMap<Page, string>();
let pages = 0;
const watched = new WeakSet<Page>();

/** Names each page in the log by the order it was first seen in the test. */
const labelOf = (page: Page) => {
  const known = labels.get(page);
  if (known) return known;
  const label = `page${(pages += 1)}`;
  labels.set(page, label);
  return label;
};

export function recordDiagnostic(page: Page, line: string) {
  lines.push(
    `+${Math.round(performance.now() - started)}ms ${labelOf(page)} ${line}`,
  );
}

/** Starts recording a page's console messages and uncaught errors. */
export function watchPage(page: Page) {
  if (watched.has(page)) return;
  watched.add(page);
  labelOf(page);
  page.on('console', (message) =>
    recordDiagnostic(page, `console.${message.type()} ${message.text()}`),
  );
  page.on('pageerror', (error) =>
    recordDiagnostic(page, `pageerror ${error.name}: ${error.message}`),
  );
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame())
      recordDiagnostic(page, `navigated ${new URL(frame.url()).pathname}`);
  });
}

/**
 * Every spec's test (ISSUE-253; a lint rule rejects importing Playwright's
 * own). Its page is created as a bounded step, so a BrowserContext.newPage
 * that never answers fails by name at 15 s instead of as a bare 30 s
 * "while setting up page" (ISSUE-233, ISSUE-243), and it is watched, so a
 * failed test keeps its browser-diagnostics.log beside its trace.
 */
export const test = playwright.test.extend({
  page: async ({ context }, provide, testInfo) => {
    lines.length = 0;
    pages = 0;
    started = performance.now();
    const page = await boundedStep(
      'creating the test page (fixture setup)',
      () => context.newPage(),
    );
    watchPage(page);
    await provide(page);
    if (testInfo.status !== testInfo.expectedStatus)
      await writeFile(
        testInfo.outputPath('browser-diagnostics.log'),
        `${lines.join('\n')}\n`,
      );
  },
});

export { expect } from '@playwright/test';
