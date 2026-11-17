import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { EmailMessage } from '../mail/types';
import { createUnreadMessagesEmailDelivery } from './unread-email';

setupRitewayBun();

const NOW = '2026-11-16T12:00:00.000Z';

const run = async (online: boolean) => {
  const sent: EmailMessage[] = [];
  const settled: unknown[] = [];
  const postponed: unknown[] = [];
  await createUnreadMessagesEmailDelivery({
    store: {
      claimMessagingUnreadEmails: async () => [
        { id: 'job-1', attempts: 1, token: 'tok' },
      ],
      readMessagingUnreadEmailDelivery: async () => ({
        kind: 'send',
        to: 'member@daisy.invalid',
        userId: 'memberuser00000000000001',
        actorId: 'memberactor0000000000001',
        conversations: 2,
      }),
      settleMessagingUnreadEmail: async (input) => {
        settled.push(input.outcome);
        return true;
      },
      postponeMessagingUnreadEmail: async (input) => {
        postponed.push(input.until);
        return true;
      },
    },
    deliver: async (message) => {
      sent.push(message);
      return 'sent';
    },
    isOnline: async () => online,
    appUrl: 'https://daisy.example.com',
    unsubscribeSubkey: 'a'.repeat(64),
    nextToken: () => 'tok',
    now: () => NOW,
    failed: () => {},
  }).run(1);
  return { sent, settled, postponed };
};

test('the unread-messages email', async () => {
  const away = await run(false);
  const here = await run(true);
  assert({
    given: 'two waiting conversations, the member away, then in Daisy',
    should:
      'send only the count and a link to Messages, then wait 15 minutes instead',
    actual: {
      subject: away.sent[0]?.subject,
      messages: away.sent[0]?.text.includes(
        'https://daisy.example.com/messages',
      ),
      settled: away.settled,
      here: { sent: here.sent.length, postponed: here.postponed },
    },
    expected: {
      subject: '2 conversations have messages for you. · Daisy',
      messages: true,
      settled: [{ kind: 'sent' }],
      here: { sent: 0, postponed: ['2026-11-16T12:15:00.000Z'] },
    },
  });
});
