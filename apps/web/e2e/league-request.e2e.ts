import { createId } from '@paralleldrive/cuid2';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from './support/fixtures';
import { assertNoSeriousFindings } from './support/axe';

/**
 * PYL-17: a signed-out visitor goes from League's "Talk to us" on /pricing
 * to /contact/league, sends a request and sees the confirmation; the
 * request is stored once. The spec opens `pricing-page` and
 * `league-requests` and closes them again; the suite runs one worker, so no
 * other spec sees them open.
 */
const run = (script: string, ...args: string[]) =>
  promisify(execFile)(
    'bun',
    [fileURLToPath(new URL(`./support/${script}`, import.meta.url)), ...args],
    { timeout: 20000, maxBuffer: 4096 },
  );
const setFlags = async (state: 'enabled' | 'default') => {
  await run('release-flag-process.ts', 'pricing-page', state);
  await run('release-flag-process.ts', 'league-requests', state);
};
const marker = createId();
const stored = async () =>
  JSON.parse(
    (await run('league-request-process.ts', 'count', marker)).stdout,
  ) as {
    count: number;
    state: string | null;
    schools: string | null;
    divisions: string | null;
  };

test.describe.configure({ mode: 'serial' });
test.beforeEach(async () => {
  await setFlags('enabled');
});
test.afterAll(async () => {
  await run('league-request-process.ts', 'remove', marker);
  await setFlags('default');
});

test('/contact/league does not exist while its release flag is closed', async ({
  page,
}) => {
  await run('release-flag-process.ts', 'league-requests', 'default');
  const response = await page.goto('/contact/league');
  expect(response?.status()).toBe(404);
});

test('a signed-out visitor sends a League request from /pricing', async ({
  page,
}) => {
  await page.goto('/pricing');
  const league = page.getByRole('region', { name: 'League', exact: true });
  await league.getByRole('link', { name: 'Talk to us' }).click();
  await expect(page).toHaveURL(/\/contact\/league$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Talk to us about a league',
  );
  await assertNoSeriousFindings(page);

  const form = page.getByRole('form', { name: 'Talk to us about a league' });
  // Sent with only two choices made, each required field says what it needs,
  // focus goes to the first, and the choices are still the ones made.
  await form.getByLabel('How many schools').selectOption('26-50');
  await form.getByLabel('Divisions').selectOption('youth-and-open');
  await form.getByRole('button', { name: 'Send to Daisy' }).click();
  await expect(form.getByLabel('League name')).toBeFocused();
  await expect(
    form.getByText('Enter your name, up to 120 characters.'),
  ).toBeVisible();
  await expect(form.getByLabel('How many schools')).toHaveValue('26-50');
  await expect(form.getByLabel('Divisions')).toHaveValue('youth-and-open');
  expect((await stored()).count).toBe(0);

  await form.getByLabel('League name').fill(`Gulf Coast ${marker}`);
  await form
    .getByLabel('What you need')
    .fill('We run 8 tournaments a season and keep standings in a spreadsheet.');
  await form.getByLabel('Your name').fill('Dana Whitfield');
  await form.getByLabel('Your role').fill('League director');
  await form.getByLabel('Email').fill('dana@example.test');
  await form.getByRole('button', { name: 'Send to Daisy' }).click();

  const confirmation = page.getByRole('heading', {
    name: 'Thanks. We’ll reply within two working days.',
  });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toBeFocused();
  await assertNoSeriousFindings(page);
  expect(await stored()).toEqual({
    count: 1,
    state: 'queued',
    schools: '26-50',
    divisions: 'youth-and-open',
  });
});

test('/contact/league stacks on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/contact/league');
  const form = await page
    .getByRole('form', { name: 'Talk to us about a league' })
    .boundingBox();
  const next = await page
    .getByRole('complementary', { name: 'What happens next' })
    .boundingBox();
  expect(form && next).toBeTruthy();
  expect(next!.y).toBeGreaterThanOrEqual(form!.y + form!.height);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  await assertNoSeriousFindings(page);
});
