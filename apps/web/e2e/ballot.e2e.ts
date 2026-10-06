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

test('on a phone every slider is usable and the names are whole', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
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
  await assertNoSeriousFindings(page);
});

/** The right edge of a box, or 0 when the element is not laid out. */
const rightEdge = (box: { x: number; width: number } | null): number =>
  box === null ? 0 : box.x + box.width;

/** Every given cell ends inside the table: nothing is clipped. */
async function expectInside(table: Locator, cells: readonly Locator[]) {
  const right = rightEdge(await table.boundingBox());
  for (const cell of cells)
    expect(rightEdge(await cell.boundingBox())).toBeLessThanOrEqual(right);
}

for (const width of [390, 1024, 1280]) {
  // A phone drops the head row and names the judge in each cell instead.
  const phone = width < 641;
  test(`the result shows every judge's scores at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/debates/started?turn=6&kind=person&as=judge&by=person');
    await expect(
      page.getByRole('heading', { name: 'Maya Singh wins' }),
    ).toBeVisible();
    const table = page.getByRole('table', { name: 'Speaker scores' });
    const headers = phone
      ? []
      : ['Judge', 'AI judge'].map((name) =>
          table.getByRole('columnheader', { name, exact: true }),
        );
    for (const header of headers) await expect(header).toBeInViewport();
    const totals = table.getByRole('row').last().getByRole('cell');
    await expect(totals).toHaveCount(2);
    await expectInside(table, [...headers, ...(await totals.all())]);
    await assertNoSeriousFindings(page);
  });
}
