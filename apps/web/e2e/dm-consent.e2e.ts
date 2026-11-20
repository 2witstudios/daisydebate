import { systemClock } from '@daisy/clock';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, openPage, test } from './support/fixtures';
import {
  birthAged,
  origin,
  resetRateLimits,
  signUpMember,
} from './support/accounts';

/**
 * DMs like Discord, with consent before an adult's contact with a minor
 * (decision 90, ADR 0160), through the real pages: a 14-year-old and a
 * 16-year-old DM through a message request; an adult's cold request to a
 * 14-year-old is refused and the profile offers Add friend; once the minor
 * accepts the friendship, the adult's request opens a DM.
 */
type Member = {
  readonly context: BrowserContext;
  readonly username: string;
};

async function withMembers(
  browser: Browser,
  ages: readonly number[],
  work: (members: readonly Member[]) => Promise<void>,
) {
  const contexts: BrowserContext[] = [];
  try {
    const members: Member[] = [];
    for (const age of ages) {
      const context = await browser.newContext({
        baseURL: origin,
        ignoreHTTPSErrors: true,
      });
      contexts.push(context);
      const { username } = await signUpMember(
        context.request,
        birthAged(systemClock.now(), age),
      );
      members.push({ context, username });
    }
    await work(members);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
}

/** Presses Message on `to`'s profile and returns the pending request's id. */
async function messageFromProfile(page: Page, to: string) {
  await page.goto(`/profile/${to}`);
  await page
    .getByRole('button', { name: `Message @${to}`, exact: true })
    .click();
  await expect(page).toHaveURL(/\/messages\/requests\/[a-z0-9]{24}\/status$/);
  return new URL(page.url()).pathname.split('/')[3]!;
}

/** The recipient accepts the request and reaches the open conversation. */
async function accept(page: Page, channelId: string) {
  await page.goto(`/messages/requests/${channelId}`);
  await page
    .getByRole('button', { name: 'Accept request', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/messages/${channelId}$`));
  await expect(
    page.getByRole('textbox', { name: 'Your message', exact: true }),
  ).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await resetRateLimits(request);
});

test('a 14-year-old and a 16-year-old DM through a message request', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await withMembers(browser, [14, 16], async ([younger, older]) => {
    const asker = await openPage(younger!.context, 'the 14-year-old');
    const channelId = await messageFromProfile(asker, older!.username);
    const answerer = await openPage(older!.context, 'the 16-year-old');
    await accept(answerer, channelId);
  });
});

test("an adult's cold request to a 14-year-old is refused with Add friend, and works after the friendship", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  await withMembers(browser, [30, 14], async ([adult, minor]) => {
    const adultPage = await openPage(adult!.context, 'the adult');
    await adultPage.goto(`/profile/${minor!.username}`);
    await expect(
      adultPage.getByText(
        `Add @${minor!.username} as a friend to send them a message.`,
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      adultPage.getByRole('button', {
        name: `Message @${minor!.username}`,
        exact: true,
      }),
    ).toHaveCount(0);

    // Typed by hand, the request is refused like any unknown member.
    await adultPage.goto('/messages/new');
    await adultPage
      .getByLabel('Username', { exact: true })
      .fill(minor!.username);
    await adultPage
      .getByRole('button', { name: 'Send request', exact: true })
      .click();
    await expect(
      adultPage.getByText(
        'Could not start this conversation. Your draft is kept; try again.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(adultPage).toHaveURL(/\/messages\/new/);

    await adultPage.goto(`/profile/${minor!.username}`);
    await adultPage
      .getByRole('button', { name: `Add friend @${minor!.username}` })
      .click();
    await adultPage.reload();
    await expect(
      adultPage.getByRole('button', {
        name: `Message @${minor!.username}`,
        exact: true,
      }),
    ).toHaveCount(0);
    const minorPage = await openPage(minor!.context, 'the 14-year-old');
    await minorPage.goto('/friends');
    await minorPage
      .getByRole('button', { name: `Accept @${adult!.username}` })
      .click();
    await expect(
      minorPage.getByRole('button', { name: `Remove @${adult!.username}` }),
    ).toBeVisible();

    const channelId = await messageFromProfile(adultPage, minor!.username);
    await accept(minorPage, channelId);
  });
});

test('a minor asks an adult, and the adult’s Message on the minor’s profile opens their DM', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await withMembers(browser, [15, 30], async ([minor, adult]) => {
    const minorPage = await openPage(minor!.context, 'the 15-year-old');
    const channelId = await messageFromProfile(minorPage, adult!.username);
    const adultPage = await openPage(adult!.context, 'the adult');
    await accept(adultPage, channelId);
    await adultPage.goto(`/profile/${minor!.username}`);
    await adultPage
      .getByRole('button', { name: `Message @${minor!.username}`, exact: true })
      .click();
    await expect(adultPage).toHaveURL(new RegExp(`/messages/${channelId}$`));

    await adultPage.goto('/settings');
    const settings = adultPage.getByRole('form', { name: 'Message requests' });
    await settings.getByRole('radio', { name: 'No one' }).check();
    await settings.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(settings.getByRole('status')).toHaveText('Saved.');
    await adultPage.reload();
    await expect(settings.getByRole('radio', { name: 'No one' })).toBeChecked();

    await minorPage.goto(`/profile/${adult!.username}`);
    await minorPage
      .getByRole('button', { name: `Message @${adult!.username}`, exact: true })
      .click();
    await expect(minorPage).toHaveURL(new RegExp(`/messages/${channelId}$`));
  });
});
