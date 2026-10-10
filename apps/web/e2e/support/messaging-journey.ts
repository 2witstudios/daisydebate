import type { Browser, BrowserContext, Page } from '@playwright/test';
import { idSchema } from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { createRoomAccounts } from './room-accounts';
import { origin } from './accounts';
import { openMessagingBrowserData } from './messaging-data';

/** Actual signup/cookies, explicit isolated age policy inputs, and scoped teardown. */
async function openJourney(
  browser: Browser,
  javaScriptEnabled: boolean,
  kind: 'dm' | 'private_group',
) {
  const signup = await createRoomAccounts(browser, 3);
  const contexts: BrowserContext[] = [];
  let data: Awaited<ReturnType<typeof openMessagingBrowserData>> | undefined;
  try {
    data = await openMessagingBrowserData(signup.members);
    for (const member of signup.members) {
      contexts.push(
        await browser.newContext({
          baseURL: origin,
          ignoreHTTPSErrors: true,
          javaScriptEnabled,
          storageState: await member.context.storageState(),
        }),
      );
    }
    const [sender, recipient, outsider] = contexts;
    const recipientAccount = data.accounts.find(
      (account) => account.userId === signup.members[1]?.userId,
    );
    if (
      !sender ||
      !recipient ||
      !outsider ||
      !recipientAccount ||
      !signup.members[1] ||
      !signup.members[0]
    )
      throw new Error('Messaging browser accounts unavailable');
    const introduction = 'An isolated browser message request';
    const senderPage = await openPage(
      sender,
      'the native conversation creation',
    );
    const names = signup.members.slice(1).map((member) => member.username);
    const channelId = await createNativeConversation(
      senderPage,
      kind,
      names,
      introduction,
    );
    data.channels.push(channelId);
    return {
      sender,
      recipient,
      outsider,
      channelId,
      introduction,
      senderUsername: signup.members[0].username,
      recipientUsername: signup.members[1].username,
      async close() {
        await Promise.all(contexts.map((context) => context.close()));
        try {
          await data?.close();
        } finally {
          await signup.dispose();
        }
      },
    };
  } catch (error) {
    await Promise.all(contexts.map((context) => context.close()));
    try {
      await data?.close();
    } finally {
      await signup.dispose();
    }
    throw error;
  }
}
export function openMessagingJourney(
  browser: Browser,
  javaScriptEnabled = true,
) {
  return openJourney(browser, javaScriptEnabled, 'dm');
}
export function openMessagingGroupJourney(
  browser: Browser,
  javaScriptEnabled = true,
) {
  return openJourney(browser, javaScriptEnabled, 'private_group');
}
async function createNativeConversation(
  page: Page,
  kind: 'dm' | 'private_group',
  names: readonly string[],
  introduction: string,
) {
  await page.goto(kind === 'dm' ? '/messages/new' : '/messages/new?kind=group');
  await page
    .getByLabel(kind === 'dm' ? 'Username' : 'Invite usernames', {
      exact: true,
    })
    .fill(kind === 'dm' ? (names[0] ?? '') : names.join(', '));
  if (kind === 'dm')
    await page.getByLabel('Introduction (optional)').fill(introduction);
  else
    await page
      .getByLabel('Group name', { exact: true })
      .fill('Isolated native group');
  await page
    .getByRole('button', {
      name: kind === 'dm' ? 'Send request' : 'Create private group',
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(
    kind === 'dm'
      ? /\/messages\/requests\/[^/]+\/status$/
      : /\/messages\/[a-z0-9]{24}$/,
  );
  return idSchema.parse(
    new URL(page.url()).pathname.split('/')[kind === 'dm' ? 3 : 2],
  );
}
export async function acceptMessagingJourney(
  journey: Awaited<ReturnType<typeof openMessagingJourney>>,
) {
  const page = await openPage(journey.recipient, 'the protected DM request');
  await page.goto('/messages');
  await page
    .getByRole('link', { name: 'Message request', exact: true })
    .click();
  await expect(
    page.getByText(journey.introduction, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Accept request', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/messages/${journey.channelId}$`));
  await expect(page.getByLabel('Your message')).toBeVisible();
  return page;
}

export async function manageNativeMessagingGroup(
  page: Page,
  channelId: string,
  operation: 'remove' | 'transfer' | 'archive' | 'leave',
  target?: string,
) {
  const labels = {
    remove: 'Remove a member',
    transfer: 'Transfer management',
    archive: 'Archive group',
    leave: 'Leave group',
  };
  await page.goto(
    `/messages/groups/${channelId}/manage?operation=${operation}`,
  );
  if (target !== undefined)
    await page.getByLabel('Member username', { exact: true }).fill(target);
  await page
    .getByRole('button', { name: labels[operation], exact: true })
    .click();
  await expect(page).toHaveURL(
    operation === 'leave'
      ? /\/messages$/
      : new RegExp(`/messages/${channelId}$`),
  );
}
