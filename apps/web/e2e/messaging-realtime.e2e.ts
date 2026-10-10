import {
  editNativeMessage,
  messageInHistory,
  removeNativeMessage,
} from './support/messaging-message-controls';
import { manageNativeReactions } from './support/messaging-reactions';
import { proveNativeTyping } from './support/messaging-typing';
import type { ServerMessage } from '@daisy/protocol';
import { manageNativePreferences } from './support/messaging-preferences';
import { attachNativeMessageFile } from './support/messaging-attachments';
import { serverMessageSchema } from '@daisy/protocol';
import { test, expect, openPage } from './support/fixtures';
import {
  openMessagingJourney,
  openMessagingGroupJourney,
  acceptMessagingJourney,
  manageNativeMessagingGroup,
  renewNativeGroupInvitation,
} from './support/messaging-journey';

test('an authenticated DM doorbell refetches current history in the other real browser', async ({
  browser,
}) => {
  const journey = await openMessagingJourney(browser);
  try {
    const recipient = await acceptMessagingJourney(journey);
    const sender = await openPage(journey.sender, 'the realtime DM recipient');
    const subscribed: string[] = [];
    const typingHints: Extract<ServerMessage, { type: 'typing_changed' }>[] =
      [];
    const bells: unknown[] = [];
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
        if (result.data.type === 'event') bells.push(result.data.payload);
        if (result.data.type === 'typing_changed')
          typingHints.push(result.data);
      }),
    );
    await sender.goto(`/messages/${journey.channelId}`);
    await expect
      .poll(() => subscribed.includes(`channel:${journey.channelId}`))
      .toBe(true);
    await proveNativeTyping(sender, recipient, journey.channelId, typingHints);
    const text = 'Delivered through a real authenticated socket';
    await recipient.getByLabel('Your message').fill(text);
    await recipient
      .getByRole('button', { name: 'Send message', exact: true })
      .click();
    await expect(messageInHistory(sender, text)).toHaveCount(1);
    expect(
      bells.some(
        (payload) =>
          typeof payload === 'object' &&
          payload !== null &&
          'kind' in payload &&
          payload.kind === 'channel.changed',
      ),
    ).toBe(true);
    expect(JSON.stringify(bells)).not.toContain(text);
    expect(invalidFrames).toEqual([]);
  } finally {
    await journey.close();
  }
});

for (const javaScriptEnabled of [true, false]) {
  test(`a recipient accepts a DM and sends durable history with JavaScript ${javaScriptEnabled ? 'enabled' : 'disabled'}`, async ({
    browser,
  }) => {
    const journey = await openMessagingJourney(browser, javaScriptEnabled);
    try {
      const recipient = await acceptMessagingJourney(journey);
      const text = 'Native browser DM history';
      await recipient.getByLabel('Your message').fill(text);
      await recipient
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      await expect(messageInHistory(recipient, text)).toBeVisible();
      const sender = await openPage(
        journey.sender,
        'the sender durable history',
      );
      await sender.goto(`/messages/${journey.channelId}`);
      await expect(messageInHistory(sender, text)).toHaveCount(1);
      await attachNativeMessageFile(recipient, sender, journey.channelId, text);
      await manageNativePreferences(sender, journey.channelId);
      await manageNativeReactions(sender, journey.channelId, text);
      const ownMessage = await editNativeMessage(sender, journey.channelId);
      const foreign = await journey.outsider.request.get(
        `/api/messaging/channels/${journey.channelId}/messages`,
      );
      expect([403, 404]).toContain(foreign.status());
      const foreignSearch = await journey.outsider.request.get(
        `/api/messaging/channels/${journey.channelId}/messages/search?query=browser`,
      );
      expect([403, 404]).toContain(foreignSearch.status());
      await sender
        .getByRole('searchbox', { name: 'Search messages' })
        .fill('browser');
      await sender.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(messageInHistory(sender, text)).toHaveCount(1);
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
      await expect(messageInHistory(sender, text)).toHaveCount(1);
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
        .getByLabel('Your message')
        .fill('Retained retry after unblock');
      await sender
        .getByRole('button', { name: 'Send message', exact: true })
        .click();
      await expect(sender.getByLabel('Your message')).toHaveValue(
        'Retained retry after unblock',
      );
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
    } finally {
      await journey.close();
    }
  });
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
      await invited.getByLabel('Your message').fill(text);
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
      await creator.goto('/messages');
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
