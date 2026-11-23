import { createId } from '@paralleldrive/cuid2';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, test } from './support/fixtures';
import { assertNoSeriousFindings } from './support/axe';

/**
 * SUPP-1: a signed-out visitor goes from Help to /support, sees a safety
 * concern point to Report, sends a message and sees the confirmation; the
 * message is stored once. /support has no release flag: it is always open.
 */
const run = (...args: string[]) =>
  promisify(execFile)(
    'bun',
    [
      fileURLToPath(
        new URL('./support/support-message-process.ts', import.meta.url),
      ),
      ...args,
    ],
    { timeout: 20000, maxBuffer: 4096 },
  );
const marker = createId();
const stored = async () =>
  JSON.parse((await run('count', marker)).stdout) as {
    count: number;
    state: string | null;
    topic: string | null;
    reply_email: string | null;
  };

test.describe.configure({ mode: 'serial' });
test.afterAll(async () => {
  await run('remove', marker);
});

test('a signed-out visitor sends a support message from Help', async ({
  page,
}) => {
  await page.goto('/help');
  await page.getByRole('link', { name: 'Contact support' }).click();
  await expect(page).toHaveURL(/\/support$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Contact support',
  );
  await assertNoSeriousFindings(page);

  const form = page.getByRole('form', { name: 'Contact support' });
  // A safety concern points to Report, and the form still sends.
  await form.getByLabel('What is this about').selectOption('safety');
  await expect(form.getByText('use Report on it')).toBeVisible();

  // Sent empty, the message says what it needs, focus goes to it, and the
  // topic is still the one chosen.
  await form.getByRole('button', { name: 'Send message' }).click();
  await expect(form.getByLabel('Message')).toBeFocused();
  await expect(
    form.getByText('Write your message, up to 4,000 characters.'),
  ).toBeVisible();
  await expect(form.getByLabel('What is this about')).toHaveValue('safety');
  expect((await stored()).count).toBe(0);

  await form
    .getByLabel('Message')
    .fill('Someone kept talking over me in the round.');
  await form
    .getByLabel('What page or round is this about? (optional)')
    .fill(`Tuesday evening round ${marker}`);
  await form.getByLabel('Email for our reply').fill('sam@example.test');
  await form.getByRole('button', { name: 'Send message' }).click();

  const confirmation = page.getByRole('heading', {
    name: 'Thanks. Your message was sent.',
  });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toBeFocused();
  await assertNoSeriousFindings(page);
  expect(await stored()).toEqual({
    count: 1,
    state: 'queued',
    topic: 'safety',
    reply_email: 'sam@example.test',
  });
});

test('/support fits a phone and an account question points to Settings', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/support');
  const form = page.getByRole('form', { name: 'Contact support' });
  await form.getByLabel('What is this about').selectOption('account');
  await expect(form.getByRole('link', { name: 'Settings' })).toHaveAttribute(
    'href',
    '/settings#privacy',
  );
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  await assertNoSeriousFindings(page);
});
