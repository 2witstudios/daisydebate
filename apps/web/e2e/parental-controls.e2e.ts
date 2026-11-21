import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Page } from '@playwright/test';
import { systemClock } from '@daisy/clock';
import {
  confirmSignIn,
  emailedLink,
  freshEmail,
  origin,
  signUpMember,
  uniqueName,
  youthBirth,
} from './support/accounts';
import { expect, openPage, test } from './support/fixtures';
import { claimUsername } from './support/forms';

const flag = (state: 'enabled' | 'default') =>
  promisify(execFile)(
    'bun',
    [
      fileURLToPath(
        new URL('./support/release-flag-process.ts', import.meta.url),
      ),
      'parental-controls',
      state,
    ],
    { timeout: 20_000, maxBuffer: 4096 },
  );

test.beforeAll(async () => {
  await flag('enabled');
});
test.afterAll(async () => {
  await flag('default');
});

const agree = (form: ReturnType<Page['locator']>) =>
  form.getByLabel('I have read and agree to this notice.').check();

const childrenOf = (page: Page) =>
  page.getByRole('region', { name: 'Your children' });
const parentsOf = (page: Page) =>
  page.getByRole('region', { name: 'Linked parents and requests' });
const familyRow = (region: ReturnType<Page['locator']>, username: string) =>
  region.getByRole('listitem').filter({
    has: region
      .page()
      .getByRole('heading', { name: `@${username}`, exact: true }),
  });

test('a parent creates a child’s account and the child uses the emailed sign-in', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const parent = await signUpMember(page.request);
  await page.goto('/settings');
  const jump = page.getByLabel('Section', { exact: true });
  if (await jump.isVisible())
    await jump.selectOption('/settings/parental-controls');
  else
    await page
      .getByRole('link', { name: 'Parental controls', exact: true })
      .click();
  await page.getByText('Create a child’s account', { exact: true }).click();
  const form = page
    .locator('form')
    .filter({ has: page.getByLabel('Child’s email') });
  const email = freshEmail();
  const { year, month } = youthBirth(systemClock.now());
  await form.getByLabel('First name').fill('Sam');
  await form
    .getByLabel('Birth month and year')
    .fill(`${year}-${String(month).padStart(2, '0')}`);
  await form.getByLabel('Child’s email').fill(email);
  await agree(form);
  await form.getByRole('button', { name: 'Email my child' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: `We emailed ${email}.` }),
  ).toBeVisible();
  const context = await browser.newContext({
    baseURL: origin,
    ignoreHTTPSErrors: true,
  });
  try {
    const child = await openPage(context, 'new child');
    await confirmSignIn(child, await emailedLink(page.request, email));
    await expect(
      child.getByRole('heading', { name: 'Your Daisy account' }),
    ).toBeVisible();
    await expect(child.getByLabel('Month', { exact: true })).toHaveCount(0);
    await child.getByLabel(/I agree to the Terms/).check();
    await child.getByRole('button', { name: 'Continue' }).click();
    await expect(child).toHaveURL(/\/onboarding\/lobby/);
    await child.getByRole('link', { name: 'Continue', exact: true }).click();
    const username = uniqueName('child');
    await claimUsername(child, username);
    await expect(child).toHaveURL(/\/onboarding\/passkey/);
    await child.goto('/settings/your-parents');
    await expect(
      familyRow(parentsOf(child), parent.username).getByText('Linked', {
        exact: true,
      }),
    ).toBeVisible();
    await child.goto('/play');
    await expect(child).toHaveURL(/\/play(?:$|\?)/);
    await page.reload();
    await expect(
      familyRow(childrenOf(page), username).getByText('Linked', {
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test('an existing child can privately confirm or refuse a link', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const parent = await signUpMember(page.request);
  await page.goto('/settings/parental-controls');
  for (const consent of ['confirm', 'refuse'] as const) {
    const context = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
    try {
      const child = await openPage(context, consent);
      const account = await signUpMember(
        child.request,
        youthBirth(systemClock.now()),
      );
      if (consent === 'confirm') {
        await page
          .getByText('Create a child’s account', { exact: true })
          .click();
        const form = page
          .locator('form')
          .filter({ has: page.getByLabel('Child’s email') });
        const { year, month } = youthBirth(systemClock.now());
        await form.getByLabel('First name').fill('Chris');
        await form
          .getByLabel('Birth month and year')
          .fill(`${year}-${String(month).padStart(2, '0')}`);
        await form.getByLabel('Child’s email').fill(account.email);
        await agree(form);
        await form.getByRole('button', { name: 'Email my child' }).click();
        await expect(
          page
            .getByRole('status')
            .filter({ hasText: `We emailed ${account.email}.` }),
        ).toBeVisible();
        await expect(familyRow(childrenOf(page), account.username)).toHaveCount(
          0,
        );
        await expect(async () => {
          const link = await emailedLink(page.request, account.email);
          expect(new URL(link).pathname).toBe('/settings/your-parents');
        }).toPass();
      } else {
        await page
          .getByText('Link an existing account', { exact: true })
          .click();
        const form = page
          .locator('form')
          .filter({ has: page.getByLabel('Child’s username') });
        await form.getByLabel('Child’s username').fill(account.username);
        await agree(form);
        await form.getByRole('button', { name: 'Ask to link' }).click();
        await expect(
          page.getByText('Request sent.', { exact: true }),
        ).toBeVisible();
      }
      await child.goto('/settings/your-parents');
      const request = familyRow(parentsOf(child), parent.username);
      if (consent === 'confirm') {
        await agree(request);
        await request
          .getByRole('button', { name: 'Yes, this is my parent' })
          .click();
        await expect(
          request.getByText('Linked', { exact: true }),
        ).toBeVisible();
      } else {
        await request
          .getByRole('button', { name: 'No, this isn’t my parent' })
          .click();
        await expect(request).toHaveCount(0);
      }
      await page.reload();
      const childRow = familyRow(childrenOf(page), account.username);
      await expect(
        childRow.getByText(consent === 'confirm' ? 'Linked' : 'Not confirmed', {
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  }
});
