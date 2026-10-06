import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { assertNoSeriousFindings } from './support/axe';
import { resetRateLimits, signUpMember } from './support/accounts';
import { expectNotInUrl } from './support/forms';
import { effectsRan } from './support/hydration';

/**
 * The judge's ballot (ISSUE-348): one real POST that works with and without
 * JavaScript, keeps everything entered when it is refused, and is usable on
 * a phone. The finished debate shows both judges' ballots.
 */
test.beforeEach(async ({ page, request }) => {
  await resetRateLimits(request);
  await signUpMember(page.request);
});

const ballotUrl = '/judge/ballot/started';
const submit = (page: Page) =>
  page.getByRole('button', { name: 'Submit ballot' }).click();
const pick = (page: Page, name: string) =>
  page.locator('label', { hasText: name }).first().click();
const radio = (page: Page, name: string) =>
  page.getByRole('radio', { name: new RegExp(name) });
const slider = (page: Page, category: string, name: string) =>
  page.getByLabel(`${category}, ${name}`);

for (const javaScriptEnabled of [true, false]) {
  test.describe(`with JavaScript ${javaScriptEnabled ? 'on' : 'off'}`, () => {
    test.use({ javaScriptEnabled });

    test('a refusal keeps everything, a low-point win asks first, then it submits', async ({
      page,
    }) => {
      await page.goto(ballotUrl);
      await pick(page, 'Daniel Kim');
      await slider(page, 'Thesis', 'Maya Singh').fill('5');
      await page.getByLabel('Feedback for Maya').fill('Slow down.');
      await submit(page);

      // No reason: refused, and everything entered comes back.
      await expect(page.locator('#ballot-refusal')).toHaveText(
        'Write the reason for your decision.',
      );
      // The refusal heads the form, so the reloaded page shows it at once.
      await expect(page.locator('#ballot-refusal')).toBeInViewport();
      await expect(radio(page, 'Daniel Kim')).toBeChecked();
      await expect(slider(page, 'Thesis', 'Maya Singh')).toHaveValue('5');
      await expect(page.getByLabel('Feedback for Maya')).toHaveValue(
        'Slow down.',
      );
      if (javaScriptEnabled)
        await expect(page.locator('#ballot-refusal')).toBeFocused();

      // Daniel wins on 30 to 32: the ballot asks for a confirmation.
      const reason = 'Daniel weighed his impacts; Maya did not answer them.';
      await page.getByLabel('Reason for decision').fill(reason);
      await submit(page);
      await expect(page.locator('#ballot-refusal')).toHaveText(
        'Confirm the low-point win, or change the scores.',
      );
      await expect(
        page.getByText('Daniel Kim wins with fewer points: 30 to 32'),
      ).toBeVisible();
      await expect(radio(page, 'Daniel Kim')).toBeChecked();
      await expect(page.getByLabel('Reason for decision')).toHaveValue(reason);

      await page.getByLabel('Confirm the decision').check();
      await submit(page);
      await expect(page).toHaveURL(
        /\/judge\/ballot\/started\?state=submitted$/,
      );
      await expect(page.getByText('Ballot submitted')).toBeVisible();
      expectNotInUrl(page, reason);
    });
  });
}

/** Holds the page's scripts until `release` runs, so input lands before hydration. */
async function holdScripts(page: Page): Promise<() => void> {
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

test('input made before hydration is kept, shown and posted', async ({
  page,
}) => {
  const release = await holdScripts(page);
  // The held chunks keep the load events from firing; wait for the markup.
  await page.goto(ballotUrl, { waitUntil: 'commit' });
  await expect(slider(page, 'Delivery', 'Daniel Kim')).toBeVisible();
  await pick(page, 'Daniel Kim');
  await slider(page, 'Thesis', 'Maya Singh').fill('5');
  release();
  await effectsRan(page);

  // The read-outs start from the controls, not from a fresh sheet.
  await expect(
    page.locator('p', { hasText: 'Your vote: Daniel Kim wins' }),
  ).toBeVisible();
  await expect(
    page.getByText('Daniel Kim wins with fewer points: 30 to 32'),
  ).toBeVisible();

  // A later change leaves the earlier input alone, and the refusal keeps it.
  await slider(page, 'Delivery', 'Daniel Kim').fill('4');
  await expect(radio(page, 'Daniel Kim')).toBeChecked();
  await page.getByLabel('Reason for decision').fill('A close round.');
  await submit(page);
  await expect(page.locator('#ballot-refusal')).toHaveText(
    'Confirm the low-point win, or change the scores.',
  );
  await expect(radio(page, 'Daniel Kim')).toBeChecked();
  await expect(slider(page, 'Thesis', 'Maya Singh')).toHaveValue('5');
  await expect(slider(page, 'Delivery', 'Daniel Kim')).toHaveValue('4');
  await expect(page.getByLabel('Confirm the decision')).toBeVisible();
});

test('no winner: the refusal names both debaters', async ({ page }) => {
  await page.goto(ballotUrl);
  await page.getByLabel('Reason for decision').fill('A close round.');
  await submit(page);
  await expect(page.locator('#ballot-refusal')).toHaveText(
    'Pick who won: Maya Singh or Daniel Kim.',
  );
});

for (const width of [360, 641, 768]) {
  test(`at ${width} px every slider is usable and the names are whole`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 780 });
    await page.goto(ballotUrl);
    for (const name of ['Maya Singh', 'Daniel Kim']) {
      const box = await slider(page, 'Delivery', name).boundingBox();
      // Five stops a thumb can tell apart: at least 20 px each.
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(100);
      const label = page.locator('label', { hasText: name }).first();
      await expect(label.getByText(name, { exact: true })).toBeVisible();
      const fits = await label
        .getByText(name, { exact: true })
        .evaluate((node) => node.scrollWidth <= node.clientWidth);
      expect(fits).toBe(true);
    }
    // Scanned with a winner picked, so the unpicked card is in the scan too.
    await pick(page, 'Daniel Kim');
    await assertNoSeriousFindings(page);
  });
}

/**
 * Every cell's visible text, numbers and labels included, as laid out:
 * any text that runs past its own cell or the table's edge is reported.
 * Measuring the text, not the cells, is what catches a number printed over
 * its neighbour, since a grid track is always inside its table. Text kept
 * for screen readers only is visually hidden and left out.
 */
const overflowing = (table: Locator): Promise<string[]> =>
  table.evaluate((node) => {
    const edge = node.getBoundingClientRect();
    const range = document.createRange();
    const cells = node.querySelectorAll('[role="cell"], [role="rowheader"]');
    return [...cells].flatMap((cell) => {
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
  });

for (const width of [360, 390, 768, 920, 1024, 1280, 1440]) {
  test(`the result shows every judge's scores whole at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/debates/started?turn=6&kind=person&as=judge&by=person');
    await expect(
      page.getByRole('heading', { name: 'Maya Singh wins' }),
    ).toBeVisible();
    const table = page.getByRole('table', { name: 'Speaker scores' });
    // Both judges head their columns for a screen reader at every width.
    for (const name of ['Judge', 'AI judge'])
      await expect(
        table.getByRole('columnheader', { name, exact: true }),
      ).toHaveCount(1);
    await expect(table.getByRole('row').last().getByRole('cell')).toHaveCount(
      2,
    );
    expect(await overflowing(table)).toEqual([]);
    await assertNoSeriousFindings(page);
  });
}
