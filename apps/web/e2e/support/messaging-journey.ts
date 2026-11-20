import type { Browser, BrowserContext, Page, Request } from '@playwright/test';
import { idSchema } from '@daisy/protocol';
import { expect, openPage } from './fixtures';
import { reportingTeardown, runEveryStep } from './journey-teardown';
import { createRoomAccounts } from './room-accounts';
import { origin } from './accounts';
import { openMessagingBrowserData } from './messaging-data';
import { holdScripts, hydrated } from './hydration';

/** Actual signup/cookies, explicit isolated age policy inputs, and scoped teardown. */
async function openJourney(
  browser: Browser,
  kind: 'dm' | 'private_group',
  retainCompetitiveRecords = false,
) {
  const signup = await createRoomAccounts(browser, 3);
  const contexts: BrowserContext[] = [];
  let data: Awaited<ReturnType<typeof openMessagingBrowserData>> | undefined;
  const close = reportingTeardown(
    () =>
      runEveryStep([
        ...contexts.map((context) => () => context.close()),
        async () => data?.close(),
        // A Room proof retains its competitive record and account, as the
        // native Room launch fixture does; deleting the actor would break it.
        () =>
          retainCompetitiveRecords
            ? Promise.all(
                signup.members.map((member) => member.context.close()),
              ).then(() => undefined)
            : signup.dispose(),
      ]),
    // Soft: the test still fails, and its primary failure stays reported.
    (teardown) =>
      expect.soft(teardown, 'journey teardown failed').toBeUndefined(),
  );
  try {
    data = await openMessagingBrowserData(signup.members);
    for (const member of signup.members) {
      const context = await browser.newContext({
        baseURL: origin,
        ignoreHTTPSErrors: true,
        storageState: await member.context.storageState(),
      });
      contexts.push(context);
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
      pressureSelectors: {
        channelId,
        actorId: recipientAccount.actorId,
        userId: recipientAccount.userId,
      },
      senderUsername: signup.members[0].username,
      recipientUsername: signup.members[1].username,
      outsiderUsername: browserMemberUsername(signup.members, 2),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
export function openMessagingJourney(
  browser: Browser,
  retainCompetitiveRecords = false,
) {
  return openJourney(browser, 'dm', retainCompetitiveRecords);
}
export function openMessagingGroupJourney(browser: Browser) {
  return openJourney(browser, 'private_group');
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
  await expect(
    page
      .getByRole('list', { name: 'Conversations' })
      .getByText(journey.introduction, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', {
      name: `Message request from ${journey.senderUsername}, unread`,
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole('region', { name: 'Conversation', exact: true })
      .getByText(journey.introduction, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Accept request', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/messages/${journey.channelId}$`));
  await expect(
    page.getByRole('textbox', { name: 'Your message', exact: true }),
  ).toBeVisible();
  return page;
}

/**
 * When the membership change is made: on a page left to hydrate as it will
 * (default), with the username typed before scripts run and submitted once
 * they have, or typed and submitted before any script runs (ADR 0114).
 */
type GroupFormTiming = 'any' | 'typedBeforeHydration' | 'beforeHydration';

export async function manageNativeMessagingGroup(
  page: Page,
  channelId: string,
  operation: 'invite' | 'remove' | 'transfer' | 'archive' | 'leave',
  target?: string,
  timing: GroupFormTiming = 'any',
) {
  const labels = {
    invite: 'Invite a person',
    remove: 'Remove a member',
    transfer: 'Transfer management',
    archive: 'Archive group',
    leave: 'Leave group',
  };
  const release = timing === 'any' ? () => undefined : await holdScripts(page);
  const requests: Request[] = [];
  const record = (request: Request) => requests.push(request);
  const path = `/messages/groups/${channelId}/manage`;
  page.on('request', record);
  try {
    await page.goto(`${path}?operation=${operation}`, { waitUntil: 'commit' });
    const submit = page.getByRole('button', {
      name: labels[operation],
      exact: true,
    });
    const field = page.getByLabel('Member username', { exact: true });
    if (target !== undefined) await field.fill(target);
    if (timing === 'typedBeforeHydration') {
      release();
      await hydrated(submit);
      if (target !== undefined) await expect(field).toHaveValue(target);
    }
    await submit.click();
    await expect(page).toHaveURL(
      operation === 'leave'
        ? /\/messages$/
        : new RegExp(`/messages/${channelId}$`),
    );
    if (timing !== 'any') {
      const post = requests.find(
        (request) =>
          request.method() === 'POST' &&
          new URL(request.url()).pathname === path,
      );
      expect(post, 'membership form sends a POST').toBeDefined();
      expect(post?.isNavigationRequest()).toBe(timing === 'beforeHydration');
      if (target !== undefined) expect(post?.postData()).toContain(target);
      if (timing === 'beforeHydration')
        expect((await post?.response())?.status()).toBe(303);
    }
  } finally {
    release();
    page.off('request', record);
  }
  // Before hydration or after, the form posts: nothing typed reaches a URL.
  if (target !== undefined)
    expect(
      requests.filter((request) => request.url().includes(target)),
    ).toEqual([]);
}

/** Renewed admission preserves approved pre-join history. */
export async function renewNativeGroupInvitation(
  journey: Awaited<ReturnType<typeof openMessagingGroupJourney>>,
  creator: Page,
  declined: Page,
  text: string,
) {
  await manageNativeMessagingGroup(
    creator,
    journey.channelId,
    'invite',
    journey.outsiderUsername,
  );
  await declined.goto('/messages');
  await declined
    .getByRole('link', { name: 'Group invitation', exact: true })
    .click();
  await declined
    .getByRole('button', { name: 'Accept invitation', exact: true })
    .click();
  await expect(declined).toHaveURL(
    new RegExp(`/messages/${journey.channelId}$`),
  );
  await expect(
    declined
      .getByRole('list', { name: 'Message history' })
      .getByText(text, { exact: true }),
  ).toHaveCount(1);
}

function browserMemberUsername(
  members: readonly { readonly username: string }[],
  index: number,
) {
  const member = members[index];
  if (!member) throw new Error('Messaging browser accounts unavailable');
  return member.username;
}
