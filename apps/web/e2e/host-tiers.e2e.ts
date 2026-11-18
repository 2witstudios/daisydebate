import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from './support/fixtures';
import { signUpMember } from './support/accounts';

/**
 * Host tiers (PYL-14, PYL-15, ADR 0147) in the browser: a member hosts a
 * free tournament, its 17th entry waits, and Entries offers the upgrade in
 * place. The flags are stored for this serial file only.
 */
const run = (script: string, args: readonly string[]) =>
  promisify(execFile)(
    'bun',
    [fileURLToPath(new URL(`./support/${script}`, import.meta.url)), ...args],
    { timeout: 60_000, maxBuffer: 16_384 },
  );
const setFlag = (key: string, state: 'enabled' | 'default') =>
  run('release-flag-process.ts', [key, state]);

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  await setFlag('daisy-tab', 'enabled');
  await setFlag('host-tiers', 'enabled');
});
test.afterAll(async () => {
  await setFlag('host-tiers', 'default');
  await setFlag('daisy-tab', 'default');
});

test('a free event takes 16 entries; the 17th waits and Entries offers the upgrade', async ({
  page,
}) => {
  const { username } = await signUpMember(page.request);

  await page.goto('/host');
  await expect(
    page.getByRole('heading', { name: 'Your tournaments', level: 1 }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'New tournament or league' }).click();
  await expect(
    page.getByRole('heading', { name: 'What are you running?' }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Name', exact: true })
    .fill('Friday scrimmage');
  await page.getByRole('button', { name: 'Create tournament' }).click();
  await page.waitForURL(/\/host\/tournaments\/[a-z0-9-]+\/setup/);
  const handle = new URL(page.url()).pathname.split('/')[3]!;

  // Free hosting: the paid features are off and locked, beside the upgrade.
  await expect(page.getByText('Video and judging')).toBeVisible();
  await expect(
    page.getByText('Not on free hosting. Paid events record every room.'),
  ).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Recording' })).toBeDisabled();

  await run('hosting-seed-process.ts', [handle, username]);

  await page.goto(`/host/tournaments/${handle}/entries`);
  const notice = page.getByRole('status').filter({
    hasText: 'The event is full on free hosting.',
  });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Free hosting takes 16 entries.');
  await expect(notice).toContainText('$99 takes up to 64, $199 has no limit.');
  await notice.getByRole('link', { name: 'Upgrade this event' }).click();

  await expect(
    page.getByRole('heading', { name: 'Upgrade this event', level: 1 }),
  ).toBeVisible();
  await expect(
    page.getByRole('radio', { name: /Up to 64 entries/ }),
  ).toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Continue to checkout · $99' }),
  ).toBeVisible();
  await page.getByRole('radio', { name: /Unlimited entries/ }).check();
  await expect(
    page.getByRole('button', { name: 'Continue to checkout · $199' }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'The waiting entry can be accepted as soon as payment is confirmed.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Billing' })).toBeVisible();

  // This suite has no Stripe: checkout answers in place, and nothing is charged.
  await page
    .getByRole('button', { name: 'Continue to checkout · $199' })
    .click();
  await expect(page.getByRole('status')).toContainText(
    'Checkout is not available right now.',
  );

  await page.getByRole('link', { name: 'Billing' }).click();
  await expect(
    page.getByRole('heading', { name: 'Free hosting' }),
  ).toBeVisible();
  await expect(page.getByText('No payments for this event.')).toBeVisible();
});
