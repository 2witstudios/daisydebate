import { CLIENT_IP_HEADER } from '@daisy/ingress/client-ip';
import type { SupportMessage } from '@daisy/protocol/support-message';
import { createId } from '@paralleldrive/cuid2';
import { afterAll } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createSupportMessageNotices } from '../src/features/support/owner-notice';
import { nextWorkerToken } from '../src/server/worker-token';
import { createFlows } from './auth-mounted-flows';
import { cookieHeader, createTestApp, userIdOf, withSql } from './fixtures';
import { supportComposition } from '../src/features/support/composition';

setupRitewayBun();

const ownerAddress = 'support-owner@example.test';
const t = createTestApp({ SUPPORT_NOTIFY_EMAIL: ownerAddress });
const stored: string[] = [];
const route = t.routes(supportComposition);

afterAll(() =>
  withSql(
    (sql) =>
      sql`delete from support_messages where form_id = any(${sql.array(stored, 'text')}::text[])`,
  ),
);

const messageFor = (
  overrides: Partial<SupportMessage> = {},
): SupportMessage => {
  const messageId = overrides.messageId ?? createId();
  stored.push(messageId);
  return {
    v: 1,
    messageId,
    topic: 'problem',
    message: `The timer froze in round ${messageId}.\nA reload fixed it.`,
    about: 'Round with @dana',
    replyEmail: 'sam@example.test',
    ...overrides,
  };
};

const rowsOf = (formIds: readonly string[]) =>
  withSql(
    (sql) =>
      sql`select id, topic, about, member_user_id, state, attempts from support_messages
        where form_id = any(${sql.array([...formIds], 'text')}::text[]) order by created_at, id`,
  ) as Promise<
    Array<{
      id: string;
      topic: string;
      about: string | null;
      member_user_id: string | null;
      state: string;
      attempts: number;
    }>
  >;

const notices = () =>
  createSupportMessageNotices({
    store: t.app.database,
    deliver: (message) => t.app.deliverMail('support')(message),
    ownerAddress,
    nextToken: nextWorkerToken,
    now: () => new Date().toISOString(),
    failed: () => {},
    gaveUp: () => {},
  });

const mailsFor = (id: string) =>
  t.mailbox.mails.filter((sent) => sent.idempotencyKey === `support:${id}`);

test('a visitor’s support message is stored once and reaches the owner', async () => {
  const message = messageFor();
  const first = await route.POST(
    t.jsonPost('/api/support', message),
  );
  const again = await route.POST(
    t.jsonPost('/api/support', message),
  );

  assert({
    given: 'a valid message sent twice under one message id',
    should: 'answer received both times and store one row, its notice queued',
    actual: {
      answers: [
        first.status,
        await first.json(),
        again.status,
        await again.json(),
      ],
      rows: await rowsOf([message.messageId]),
    },
    expected: {
      answers: [200, { received: true }, 200, { received: true }],
      rows: [
        {
          id: message.messageId,
          topic: 'problem',
          about: 'Round with @dana',
          member_user_id: null,
          state: 'queued',
          attempts: 0,
        },
      ],
    },
  });

  await notices().run(10);
  const mail = mailsFor(message.messageId);
  assert({
    given: 'the notice worker runs',
    should:
      'send one email to the owner with the topic, the message and how to reply, and mark it sent',
    actual: {
      count: mail.length,
      to: mail[0]?.to,
      subject: mail[0]?.subject,
      missing: [
        'Topic: Something isn’t working',
        'About: Round with @dana',
        'Sent signed out',
        'Reply to: sam@example.test',
        `The timer froze in round ${message.messageId}.`,
        'A reload fixed it.',
      ].filter((line) => !mail[0]?.text.includes(line)),
      state: (await rowsOf([message.messageId]))[0]?.state,
      resent: await notices().run(10),
    },
    expected: {
      count: 1,
      to: ownerAddress,
      subject: 'Support: Something isn’t working',
      missing: [],
      state: 'sent',
      resent: 0,
    },
  });
});

test('a signed-in account’s message is recorded against it from the session', async () => {
  const flows = createFlows(t);
  const signup = await flows.startSignup();
  const signedIn = await flows.redeem(signup.token);
  const userId = await userIdOf(signup.email);
  const message = messageFor({ topic: 'account', about: '' });
  const answer = await route.POST(
    t.jsonPost('/api/support', message, { cookie: cookieHeader(signedIn) }),
  );
  const [row] = await rowsOf([message.messageId]);

  assert({
    given: 'a message posted with a signed-in session and no page named',
    should:
      'store it against that account, with no about line, and offer its email as the reply address',
    actual: {
      status: answer.status,
      member: row?.member_user_id === userId && userId !== undefined,
      about: row?.about,
      replyAddress: await t.app.database.readSupportReplyAddress(userId!),
    },
    expected: {
      status: 200,
      member: true,
      about: null,
      replyAddress: signup.email,
    },
  });
});

test('one client is limited, and nothing past the limit is stored', async () => {
  const client = t.newClient();
  const sent = Array.from({ length: 6 }, () => messageFor());
  const statuses: number[] = [];
  for (const message of sent)
    statuses.push(
      (
        await route.POST(
          t.jsonPost('/api/support', message, { [CLIENT_IP_HEADER]: client }),
        )
      ).status,
    );
  const fromElsewhere = await route.POST(
    t.jsonPost('/api/support', messageFor()),
  );

  assert({
    given: 'six messages from one client within the hour, then another client',
    should:
      'take five, refuse the sixth, store only the five, and take the other',
    actual: {
      statuses,
      stored: (await rowsOf(sent.map(({ messageId }) => messageId))).length,
      elsewhere: fromElsewhere.status,
    },
    expected: {
      statuses: [200, 200, 200, 200, 200, 429],
      stored: 5,
      elsewhere: 200,
    },
  });
});

test('invalid and cross-origin messages store nothing', async () => {
  const invalid = messageFor({ replyEmail: 'not an address' });
  const crossOrigin = messageFor();
  const answers = [
    await route.POST(t.jsonPost('/api/support', invalid)),
    await route.POST(
      t.jsonPost('/api/support', crossOrigin, {
        origin: 'https://elsewhere.example',
      }),
    ),
  ];

  assert({
    given: 'a bad reply address and another origin',
    should: 'refuse each without storing it',
    actual: {
      statuses: answers.map((answer) => answer.status),
      stored: (await rowsOf([invalid.messageId, crossOrigin.messageId])).length,
    },
    expected: { statuses: [400, 403], stored: 0 },
  });
});
