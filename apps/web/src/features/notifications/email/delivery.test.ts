import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createResendSender } from '../../mail/resend-sender';
import { MAIL_MAX_ATTEMPTS, mailRetryDelayMs } from '../../mail/retry-policy';
import type { EmailMessage } from '../../mail/types';
import { createNotificationDigestDelivery } from './delivery';
import { verifyUnsubscribe } from './unsubscribe-token';

setupRitewayBun();

type Store = Parameters<typeof createNotificationDigestDelivery>[0]['store'];
type Delivery = Awaited<ReturnType<Store['readNotificationDigestDelivery']>>;
type Settled = Parameters<Store['settleNotificationDigest']>[0];
type Postponed = Parameters<Store['postponeNotificationDigest']>[0];

const NOW = '2026-11-10T12:00:00.000Z';
const SUBKEY = 'a'.repeat(64);

const invitation: Delivery = {
  kind: 'send',
  to: 'judge@daisy.invalid',
  userId: 'judgeuser000000000000001',
  actorId: 'judgeactor00000000000001',
  items: [
    {
      id: 'n1',
      kind: 'room_invitation',
      roomId: 'room-1',
      seat: 'judge',
      host: 'coach',
      readAt: null,
      surfacedAt: NOW,
    },
  ],
};

const scripted = (input: {
  delivery: Delivery | (() => Promise<Delivery>);
  attempts?: number;
  deliver?: (message: EmailMessage) => Promise<'sent' | 'suppressed'>;
  online?: boolean;
}) => {
  const sent: EmailMessage[] = [];
  const settled: Settled[] = [];
  const postponed: Postponed[] = [];
  const failures: unknown[] = [];
  const delivery = createNotificationDigestDelivery({
    store: {
      claimNotificationDigests: async () => [
        { id: 'job-1', attempts: input.attempts ?? 1, token: 'tok' },
      ],
      readNotificationDigestDelivery: async () =>
        typeof input.delivery === 'function'
          ? input.delivery()
          : input.delivery,
      settleNotificationDigest: async (settle) => {
        settled.push(settle);
        return true;
      },
      postponeNotificationDigest: async (postpone) => {
        postponed.push(postpone);
        return true;
      },
    },
    isOnline: async () => input.online ?? false,
    deliver:
      input.deliver ??
      (async (message) => {
        sent.push(message);
        return 'sent';
      }),
    appUrl: 'https://daisy.example.com',
    unsubscribeSubkey: SUBKEY,
    nextToken: () => 'tok',
    now: () => NOW,
    failed: (error) => failures.push(error),
  });
  return { delivery, sent, settled, postponed, failures };
};

const rejectingSender = (response: 'lost' | 'rejected') =>
  createResendSender({
    apiKey: 'test-key',
    nowMs: () => Date.parse(NOW),
    from: 'test@example.test',
    ids: { next: () => 'id' },
    timeoutMs: 50,
    fetch: async () => {
      if (response === 'lost') throw new Error('connection lost');
      return new Response('{}', { status: 400 });
    },
  });

describe('notification digest delivery (ADR 0144)', () => {
  test('an owed digest is sent with its one-click unsubscribe', async () => {
    const { delivery, sent, settled } = scripted({ delivery: invitation });
    const count = await delivery.run(10);
    const message = sent[0];
    const header = message?.headers?.['List-Unsubscribe'] ?? '';
    const oneClick = new URL(header.slice(1, -1));
    const token = oneClick.searchParams.get('t') ?? '';
    assert({
      given: 'a due digest of one invitation, its member away',
      should:
        'send the inbox’s words to their address under the job id, with RFC 8058 headers whose link verifies for that member, and settle it sent',
      actual: {
        count,
        to: message?.to,
        key: message?.idempotencyKey,
        post: message?.headers?.['List-Unsubscribe-Post'],
        path: oneClick.pathname,
        verified:
          verifyUnsubscribe(SUBKEY, {
            userId: oneClick.searchParams.get('u') ?? '',
            token,
          }) !== null,
        subject: message?.subject,
        inboxLink: message?.text.includes(
          'https://daisy.example.com/notifications',
        ),
        settled: settled.map(({ id, token: lease, outcome }) => ({
          id,
          lease,
          outcome,
        })),
      },
      expected: {
        count: 1,
        to: 'judge@daisy.invalid',
        key: 'job-1',
        post: 'List-Unsubscribe=One-Click',
        path: '/api/notifications/unsubscribe',
        verified: true,
        subject: '@coach invited you to judge. · Daisy',
        inboxLink: true,
        settled: [{ id: 'job-1', lease: 'tok', outcome: { kind: 'sent' } }],
      },
    });
  });

  test('a job with nothing owed is cancelled unsent', async () => {
    const reasons = ['recipient-gone', 'not-owed'] as const;
    const results = [];
    for (const errorCode of reasons) {
      const { delivery, sent, settled } = scripted({
        delivery: { kind: 'cancel', errorCode },
      });
      await delivery.run(1);
      results.push({ sent: sent.length, outcome: settled[0]?.outcome });
    }
    assert({
      given:
        'a digest whose member is gone, or with nothing left unread, standing and wanted',
      should: 'cancel it with that reason and send nothing',
      actual: results,
      expected: reasons.map((errorCode) => ({
        sent: 0,
        outcome: { kind: 'cancelled' as const, errorCode },
      })),
    });
  });

  test('a DM request digest names the requester and links to the inbox', async () => {
    const channelId = 'private-dm-channel';
    const { delivery, sent } = scripted({
      delivery: {
        ...invitation,
        items: [
          {
            id: 'n1',
            kind: 'dm_request',
            from: 'member',
            channelId,
            readAt: null,
            surfacedAt: NOW,
          },
        ],
      },
    });
    await delivery.run(1);
    const message = sent[0]!;
    assert({
      given:
        'one standing message request and a recipient eligible for digest mail',
      should:
        'send the public handle and event to the mail provider, with an inbox link and no conversation identifier',
      actual: [
        message.subject,
        message.text.includes('https://daisy.example.com/notifications'),
        [message.subject, message.text, message.html].some((part) =>
          part.includes(channelId),
        ),
      ],
      expected: ['@member sent you a message request. · Daisy', true, false],
    });
  });

  test('a member in Daisy is not emailed yet', async () => {
    const { delivery, sent, settled, postponed } = scripted({
      delivery: invitation,
      online: true,
    });
    const count = await delivery.run(1);
    assert({
      given: 'a due digest whose member has Daisy open',
      should: 'send nothing and put it back for 15 minutes',
      actual: { count, sent: sent.length, settled, postponed },
      expected: {
        count: 1,
        sent: 0,
        settled: [],
        postponed: [
          { id: 'job-1', token: 'tok', until: '2026-11-10T12:15:00.000Z' },
        ],
      },
    });
  });

  test('a suppressed address cancels the job', async () => {
    const { delivery, settled } = scripted({
      delivery: invitation,
      deliver: async () => 'suppressed',
    });
    await delivery.run(1);
    assert({
      given: 'a recipient the transport suppresses',
      should: 'cancel the job as suppressed',
      actual: settled[0]?.outcome,
      expected: { kind: 'cancelled', errorCode: 'suppressed' },
    });
  });

  test('a failed send retries with backoff, then fails for good', async () => {
    const outcomes = [];
    for (const [response, attempts] of [
      ['rejected', 1],
      ['lost', 3],
      ['rejected', MAIL_MAX_ATTEMPTS],
      ['lost', MAIL_MAX_ATTEMPTS],
    ] as const) {
      const sender = rejectingSender(response);
      const { delivery, settled } = scripted({
        delivery: invitation,
        attempts,
        deliver: async (message) => {
          await sender.send(message);
          return 'sent';
        },
      });
      await delivery.run(1);
      outcomes.push(settled[0]?.outcome);
    }
    const at = (attempts: number) =>
      new Date(Date.parse(NOW) + mailRetryDelayMs(attempts)).toISOString();
    assert({
      given:
        'a definite rejection or a lost reply, before and at the attempt cap',
      should:
        'retry at the backoff, then fail, keeping an uncertain send unknown',
      actual: outcomes,
      expected: [
        { kind: 'retry', errorCode: 'delivery', nextAttemptAt: at(1) },
        { kind: 'retry', errorCode: 'delivery-unknown', nextAttemptAt: at(3) },
        { kind: 'failed', errorCode: 'delivery' },
        { kind: 'failed', errorCode: 'delivery-unknown' },
      ],
    });
  });

  test('a job whose read fails counts as a failed attempt', async () => {
    const { delivery, sent, settled, failures } = scripted({
      delivery: async () => {
        throw new Error('read failed');
      },
      attempts: 2,
    });
    const count = await delivery.run(1);
    assert({
      given: 'a send-time read that throws',
      should: 'report it, send nothing and schedule a retry',
      actual: {
        count,
        sent: sent.length,
        reported: failures.length,
        outcome: settled[0]?.outcome.kind,
      },
      expected: { count: 1, sent: 0, reported: 1, outcome: 'retry' },
    });
  });
});
