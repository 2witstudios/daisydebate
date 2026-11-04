import { testMessagingUnknownCommit } from './support/messaging-unknown-commit';
import { STEP_LIMIT_MS } from './support/bounded-step';
import { testPeopleList } from './support/people-list-live';
import { testMessagingHistoryCompletion } from './support/messaging-history-completion';
import { testMessagingNavigationOverlap } from './support/messaging-navigation-overlap';
import { testEditCompletionWindow } from './support/messaging-completion-window';
import {
  editNativeMessage,
  messageInHistory,
  removeNativeMessage,
  testMessageControlFocus,
} from './support/messaging-message-controls';
import { manageNativeReactions } from './support/messaging-reactions';
import { proveNativeTyping } from './support/messaging-typing';
import type { Page } from '@playwright/test';
import type { ServerMessage } from '@daisy/protocol';
import { manageNativePreferences } from './support/messaging-preferences';
import { attachNativeMessageFile } from './support/messaging-attachments';
import { testProfileMessageEntry } from './support/messaging-profile-entry';
import { testMessagesPage } from './support/messages-page';
import { serverMessageSchema } from '@daisy/protocol';
import { test, expect, openPage } from './support/fixtures';
import {
  openMessagingJourney,
  openMessagingGroupJourney,
  acceptMessagingJourney,
  manageNativeMessagingGroup,
  renewNativeGroupInvitation,
} from './support/messaging-journey';

const isBareInboxBell = (topic: string, payload: unknown) =>
  /^user:[^:]+:inbox$/.test(topic) &&
  JSON.stringify(payload) ===
    JSON.stringify({ kind: 'messaging.inbox.changed' });

testMessageControlFocus();
testPeopleList();
testMessagingNavigationOverlap();
testEditCompletionWindow();
testMessagingHistoryCompletion();
testMessagingUnknownCommit();
testProfileMessageEntry();
testMessagesPage();

test('an authenticated DM message reaches the other real browser as an observed snapshot', async ({
  browser,
}) => {
  const journey = await openMessagingJourney(browser);
  try {
    const recipient = await acceptMessagingJourney(journey);
    const sender = await openPage(journey.sender, 'the realtime DM recipient');
    const subscribed: string[] = [];
    const typingHints: Extract<ServerMessage, { type: 'typing_changed' }>[] =
      [];
    const events: unknown[] = [];
    const snapshots: number[] = [];
    let ready = false;
    const invalidFrames: string[] = [];
    sender.on('websocket', (socket) =>
      socket.on('framereceived', (frame) => {
        let raw: unknown;
        try {
          raw = JSON.parse(String(frame.payload));
        } catch {
          invalidFrames.push('invalid JSON');
          return;
        }
        const result = serverMessageSchema.safeParse(raw);
        if (!result.success) {
          invalidFrames.push('invalid framing');
          return;
        }
        if (result.data.type === 'subscribed')
          subscribed.push(result.data.topic);
        // The shell's challenges listen on this actor's inbox on every page
        // (ADR 0103), so its content-free bell may ring here. Nothing else may.
        if (
          result.data.type === 'event' &&
          !isBareInboxBell(result.data.topic, result.data.payload)
        )
          events.push(result.data.payload);
        if (result.data.type === 'observation.ready') ready = true;
        if (result.data.type === 'observation.snapshot')
          snapshots.push(result.data.contentRevision);
        if (result.data.type === 'typing_changed')
          typingHints.push(result.data);
      }),
    );
    await sender.goto(`/messages/${journey.channelId}`);
    await expect
      .poll(() => subscribed.includes(`channel:${journey.channelId}`))
      .toBe(true);
    await expect.poll(() => ready).toBe(true);
    await proveNativeTyping(sender, recipient, journey.channelId, typingHints);
    const text = 'Delivered through a real authenticated socket';
    await recipient
      .getByRole('textbox', { name: 'Your message', exact: true })
      .fill(text);
    await recipient
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await expect(messageInHistory(sender, text)).toHaveCount(1);
    // Content arrives as a permitted snapshot, never as a channel doorbell.
    expect(snapshots.length).toBeGreaterThan(0);
    expect(events).toEqual([]);
    expect(invalidFrames).toEqual([]);
  } finally {
    await journey.close();
  }
});

type DmJourney = Awaited<ReturnType<typeof openMessagingJourney>>;
const unreadableNotice = 'This conversation could not be marked read.';
// Playwright's text engine skips <noscript>, though a no-JS browser renders
// it, so read the notices' rendered status text directly.
const noScriptStatus = (page: Page) =>
  page
    .locator('noscript [role="status"]')
    .evaluateAll((notices) => notices.map((notice) => notice.textContent));
const replyText = 'Native browser DM history';
/** An accepted DM whose recipient has replied, with the sender's page open. */
const repliedDm = async (journey: DmJourney) => {
  const recipient = await acceptMessagingJourney(journey);
  await recipient
    .getByRole('textbox', { name: 'Your message', exact: true })
    .fill(replyText);
  await recipient
    .getByRole('button', { name: 'Send message', exact: true })
    .click();
  await expect(messageInHistory(recipient, replyText)).toBeVisible();
  const sender = await openPage(journey.sender, 'the sender durable history');
  return { recipient, sender };
};
const inboxHasNoUnread = (sender: Page) =>
  expect(async () => {
    await sender.goto('/messages');
    await expect(sender.getByRole('link', { name: /, unread$/ })).toHaveCount(
      0,
    );
  }).toPass();
/**
 * Opens a conversation. A page refused by a full lane says "Refresh to try again",
 * and a person does (ISSUE-1333); any other failure stays a failure.
 */
const openConversation = (page: Page, channelId: string) =>
  expect(async () => {
    await page.goto(`/messages/${channelId}`);
    await expect(
      page.getByText('This conversation is unavailable.'),
    ).toHaveCount(0);
  }).toPass({ timeout: STEP_LIMIT_MS });
/**
 * Opens the conversation for the sender. With a script, the page marks it read
 * once on screen, and leaving first can lose that POST, so this waits for it.
 */
const viewDm = async (
  sender: Page,
  channelId: string,
  javaScriptEnabled: boolean,
) => {
  const marked = javaScriptEnabled
    ? sender.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/messaging/read' &&
          response.ok(),
        { timeout: STEP_LIMIT_MS },
      )
    : undefined;
  await Promise.all([openConversation(sender, channelId), marked]);
};
/** That DM, read by the sender, whose page is back on the conversation. */
const readDm = async (journey: DmJourney, javaScriptEnabled: boolean) => {
  const { recipient, sender } = await repliedDm(journey);
  await viewDm(sender, journey.channelId, javaScriptEnabled);
  await expect(messageInHistory(sender, replyText)).toHaveCount(1);
  if (!javaScriptEnabled)
    await sender
      .getByRole('button', { name: 'Mark as read', exact: true })
      .click();
  await inboxHasNoUnread(sender);
  await openConversation(sender, journey.channelId);
  return { recipient, sender };
};

for (const javaScriptEnabled of [true, false]) {
  const mode = `with JavaScript ${javaScriptEnabled ? 'enabled' : 'disabled'}`;
  /** One claim about a DM, on its own journey, inside the default budget. */
  const dmTest = (
    claim: string,
    prove: (journey: DmJourney) => Promise<void>,
  ) =>
    test(`${claim} ${mode}`, async ({ browser }) => {
      const journey = await openMessagingJourney(browser, javaScriptEnabled);
      try {
        await prove(journey);
      } finally {
        await journey.close();
      }
    });

  dmTest(
    'an accepted DM reply is durable history, unread for the sender until read,',
    async (journey) => {
      const { sender } = await repliedDm(journey);
      // ISSUE-639 social clause: the reply shows unread in the sender's
      // inbox until they read it, by script or, without one, by native POST.
      await sender.goto('/messages');
      await expect(sender.getByRole('link', { name: /, unread$/ })).toHaveCount(
        1,
      );
      await viewDm(sender, journey.channelId, javaScriptEnabled);
      await expect(messageInHistory(sender, replyText)).toHaveCount(1);
      await expect(
        sender.getByRole('heading', { name: `@${journey.recipientUsername}` }),
      ).toBeVisible();
      if (!javaScriptEnabled) {
        // ISSUE-606: viewing by GET leaves it unread; only the POST marks it.
        const viewed = await sender.request.get(
          `/api/messaging/channels/${journey.channelId}/preferences`,
        );
        expect(viewed.status()).toBe(200);
        expect((await viewed.json()).unread).toBeGreaterThanOrEqual(1);
        await sender
          .getByRole('button', { name: 'Mark as read', exact: true })
          .click();
        // Back on the conversation with no submitted values and no notice.
        await expect(sender).toHaveURL(
          new RegExp(`/messages/${journey.channelId}$`),
        );
        expect(await noScriptStatus(sender)).toEqual([]);
        await sender.goto(
          `/messages/${journey.channelId}?notice=read-unavailable`,
        );
        expect(await noScriptStatus(sender)).toEqual([
          `${unreadableNotice} Try again.`,
        ]);
      }
      await inboxHasNoUnread(sender);
    },
  );

  dmTest(
    "a DM's files reach the peer, and its preferences save and clear with nothing unread,",
    async (journey) => {
      const { recipient, sender } = await readDm(journey, javaScriptEnabled);
      await attachNativeMessageFile(
        recipient,
        sender,
        journey.channelId,
        replyText,
      );
      await manageNativePreferences(sender, journey);
    },
  );

  dmTest("a DM member reacts to the peer's message", async (journey) => {
    const { sender } = await readDm(journey, javaScriptEnabled);
    await manageNativeReactions(sender, journey.channelId, replyText);
  });

  dmTest(
    'only DM members read or search its history, and a search takes its query literally,',
    async (journey) => {
      const { sender } = await readDm(journey, javaScriptEnabled);
      const foreign = await journey.outsider.request.get(
        `/api/messaging/channels/${journey.channelId}/messages`,
      );
      expect([403, 404]).toContain(foreign.status());
      const foreignSearch = await journey.outsider.request.get(
        `/api/messaging/channels/${journey.channelId}/messages/search?query=browser`,
      );
      expect([403, 404]).toContain(foreignSearch.status());
      await sender
        .getByLabel('Search this conversation', { exact: true })
        .click();
      await sender
        .getByRole('searchbox', { name: 'Search messages' })
        .fill('browser');
      await sender.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(messageInHistory(sender, replyText)).toHaveCount(1);
      await sender
        .getByRole('searchbox', { name: 'Search messages' })
        .fill('%');
      await sender.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(
        sender.getByText('No matching messages.', { exact: true }),
      ).toBeVisible();
      await sender
        .getByRole('link', { name: 'Clear search', exact: true })
        .click();
      await expect(sender).toHaveURL(
        new RegExp(`/messages/${journey.channelId}$`),
      );
      await sender.reload();
      await expect(messageInHistory(sender, replyText)).toHaveCount(1);
    },
  );

  dmTest(
    'a block keeps the draft and still lets a member remove their own message, and unblock sends it,',
    async (journey) => {
      const { recipient, sender } = await readDm(journey, javaScriptEnabled);
      const ownMessage = await editNativeMessage(sender, journey.channelId);
      await recipient.goto('/messages/contacts');
      await recipient
        .getByLabel('Username', { exact: true })
        .fill(journey.senderUsername);
      await recipient
        .getByRole('button', { name: 'Block contact', exact: true })
        .click();
      await expect(recipient.getByRole('status')).toHaveText(
        'Contact blocked.',
      );
      await sender
        .getByRole('textbox', { name: 'Your message', exact: true })
        .fill('Retained retry after unblock');
      await sender
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      await expect(
        sender.getByRole('textbox', { name: 'Your message', exact: true }),
      ).toHaveValue('Retained retry after unblock');
      await expect(sender.getByRole('status')).toHaveText(
        'You cannot send to this conversation now. Your draft is kept.',
      );
      await removeNativeMessage(journey.sender, journey.channelId, ownMessage);
      await recipient
        .getByRole('button', { name: 'Unblock contact', exact: true })
        .click();
      await expect(recipient.getByRole('status')).toHaveText(
        'Contact unblocked.',
      );
      await sender
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      await expect(
        messageInHistory(sender, 'Retained retry after unblock'),
      ).toHaveCount(1);
    },
  );
}

for (const javaScriptEnabled of [true, false]) {
  test(`native group invitation admission and refusal with JavaScript ${javaScriptEnabled ? 'enabled' : 'disabled'}`, async ({
    browser,
  }) => {
    const journey = await openMessagingGroupJourney(browser, javaScriptEnabled);
    try {
      const invited = await openPage(
        journey.recipient,
        'the native group invitation',
      );
      const refused = await journey.recipient.request.get(
        `/api/messaging/channels/${journey.channelId}/messages`,
      );
      expect(refused.status()).toBe(404);
      await invited.goto('/messages');
      await invited
        .getByRole('link', { name: 'Group invitation', exact: true })
        .click();
      await expect(
        invited.getByRole('heading', { name: 'Group invitation', exact: true }),
      ).toBeVisible();
      await expect(
        invited.getByText('Isolated native group', { exact: true }),
      ).toHaveCount(0);
      await invited
        .getByRole('button', { name: 'Accept invitation', exact: true })
        .click();
      await expect(invited).toHaveURL(
        new RegExp(`/messages/${journey.channelId}$`),
      );
      const text = 'Native admitted private group history';
      await invited
        .getByRole('textbox', { name: 'Your message', exact: true })
        .fill(text);
      await invited
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      await expect(
        invited
          .getByRole('list', { name: 'Message history' })
          .getByText(text, { exact: true }),
      ).toHaveCount(1);
      const creator = await openPage(
        journey.sender,
        'the durable group creator history',
      );
      await creator.goto(`/messages/${journey.channelId}`);
      await expect(
        creator
          .getByRole('list', { name: 'Message history' })
          .getByText(text, { exact: true }),
      ).toHaveCount(1);
      const declined = await openPage(
        journey.outsider,
        'the native invitation refusal',
      );
      await declined.goto('/messages');
      await declined
        .getByRole('link', { name: 'Group invitation', exact: true })
        .click();
      await declined
        .getByRole('button', { name: 'Decline', exact: true })
        .click();
      await expect(declined).toHaveURL(/\/messages$/);
      const unavailable = await journey.outsider.request.get(
        `/api/messaging/channels/${journey.channelId}/messages`,
      );
      expect(unavailable.status()).toBe(404);
      await creator.reload();
      await expect(
        creator
          .getByRole('list', { name: 'Message history' })
          .getByText(text, { exact: true }),
      ).toHaveCount(1);
      await creator
        .getByRole('list', { name: 'Conversations' })
        .getByRole('link', { name: /^Group / })
        .first()
        .click();
      await creator.getByLabel('Conversation options', { exact: true }).click();
      await creator
        .getByRole('link', { name: 'Group membership', exact: true })
        .click();
      await expect(
        creator.getByRole('heading', { name: 'Group membership', exact: true }),
      ).toBeVisible();
      await renewNativeGroupInvitation(journey, creator, declined, text);
      await manageNativeMessagingGroup(
        creator,
        journey.channelId,
        'transfer',
        journey.recipientUsername,
      );
      await manageNativeMessagingGroup(
        invited,
        journey.channelId,
        'remove',
        journey.senderUsername,
      );
      const removedHistory = await journey.sender.request.get(
        `/api/messaging/channels/${journey.channelId}/messages`,
      );
      expect(removedHistory.status()).toBe(404);
      await expect(
        invited
          .getByRole('list', { name: 'Message history' })
          .getByText(text, { exact: true }),
      ).toHaveCount(1);
      await manageNativeMessagingGroup(
        invited,
        journey.channelId,
        'remove',
        journey.outsiderUsername,
      );
      const revokedLateJoin = await journey.outsider.request.get(
        `/api/messaging/channels/${journey.channelId}/messages`,
      );
      expect(revokedLateJoin.status()).toBe(404);
      await manageNativeMessagingGroup(invited, journey.channelId, 'archive');
      await expect(
        invited
          .getByRole('list', { name: 'Message history' })
          .getByText(text, { exact: true }),
      ).toHaveCount(1);
      await manageNativeMessagingGroup(invited, journey.channelId, 'leave');
      const leftHistory = await journey.recipient.request.get(
        `/api/messaging/channels/${journey.channelId}/messages`,
      );
      expect(leftHistory.status()).toBe(404);
    } finally {
      await journey.close();
    }
  });
}
