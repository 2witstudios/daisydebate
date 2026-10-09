import type { Browser, BrowserContext } from '@playwright/test';
import { systemId } from '@daisy/clock';
import { messagingDmResultSchema } from '@daisy/protocol';
import { origin } from './accounts';
import { expect, openPage } from './fixtures';
import { createRoomAccounts } from './room-accounts';
import { openMessagingBrowserData } from './messaging-data';

/** Actual signup/cookies, explicit isolated age policy inputs, and scoped teardown. */
export async function openMessagingJourney(
  browser: Browser,
  javaScriptEnabled = true,
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
    if (!sender || !recipient || !outsider || !recipientAccount)
      throw new Error('Messaging browser accounts unavailable');
    const introduction = 'An isolated browser message request';
    const response = await sender.request.post('/api/messaging/requests', {
      headers: { origin },
      data: {
        version: 1,
        requestId: systemId.next(),
        recipientActorId: recipientAccount.actorId,
        introduction,
      },
    });
    expect(response.status()).toBe(200);
    const request = messagingDmResultSchema.parse(await response.json());
    expect(request.state).toBe('pending');
    data.channels.push(request.channelId);
    return {
      sender,
      recipient,
      outsider,
      channelId: request.channelId,
      introduction,
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
