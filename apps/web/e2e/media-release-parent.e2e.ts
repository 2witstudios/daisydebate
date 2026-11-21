import { systemClock } from '@daisy/clock';
import { resolveE2EPorts } from '../playwright.config';
import { assertNoSeriousFindings } from './support/axe';
import {
  freshEmail,
  origin,
  signUpMember,
  youthBirth,
} from './support/accounts';
import { expect, openPage, test } from './support/fixtures';

/**
 * PYL-6 in a real browser, at phone width: a youth member asks a parent's
 * address to sign; the parent opens the emailed link with no account and
 * no session, signs, and sees the confirmation. The flow is live with no
 * release flag (ADR 0161).
 */
const mailBase = `http://127.0.0.1:${resolveE2EPorts(process.env).mail}`;

test('a parent signs a media release on a phone, without an account', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await signUpMember(page.request, youthBirth(systemClock.now()));
  const parent = freshEmail();
  const asked = await page.request.post('/api/media-releases/ask', {
    headers: { origin },
    data: { email: parent },
  });
  expect(asked.status()).toBe(200);
  expect(await asked.json()).toMatchObject({ kind: 'asked' });

  // The mail worker sends on its own tick; the link is minted when it does.
  let link = '';
  await expect(async () => {
    const response = await page.request.get(`${mailBase}/mails?to=${parent}`);
    const mails = (await response.json()) as { text: string }[];
    link =
      mails
        .map((mail) => mail.text.match(/https:\/\/\S+\/release\?t=\S+/)?.[0])
        .find(Boolean) ?? '';
    expect(link).not.toBe('');
  }).toPass({ timeout: 60_000 });

  // The parent: a fresh browser, no cookies, no account.
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
  });
  try {
    const phone = await openPage(context, 'parent');
    const path = new URL(link);
    await phone.goto(`${path.pathname}${path.search}`);
    await expect(
      phone.getByRole('heading', { level: 1, name: /debate Rounds\?$/ }),
    ).toBeVisible();
    await expect(
      phone.getByText('[COUNSEL: takedown period]').first(),
    ).toBeVisible();
    const before = await phone.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(before).toBeLessThanOrEqual(390);
    await assertNoSeriousFindings(phone);

    await phone.getByLabel('Your full name').fill('Elena Rivera');
    await phone
      .getByRole('checkbox', { name: /I am @\S+ parent or legal guardian/ })
      .check();
    await phone.getByRole('button', { name: 'Sign release' }).click();
    await expect(
      phone.getByRole('heading', { name: 'Release signed. Thank you.' }),
    ).toBeVisible();
    await expect(phone.getByText('Elena Rivera, parent')).toBeVisible();
    await expect(phone.getByText('Not allowed')).toBeVisible();
    const after = await phone.evaluate(
      () => document.documentElement.scrollWidth,
    );
    expect(after).toBeLessThanOrEqual(390);
    await assertNoSeriousFindings(phone);

    // The same link again: used, and it says so.
    await phone.goto(`${path.pathname}${path.search}`);
    await expect(
      phone.getByRole('heading', { name: /release is signed\.$/ }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
