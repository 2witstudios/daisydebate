import { createHmac } from 'node:crypto';
import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  clearRedisNamespace,
  configureAppEnvironment,
  counts,
  fixtureEmail,
  formPost,
  installMailbox,
  jsonPost,
  linkFrom,
  removeAccount,
  webhookSecret,
  withSql,
} from './auth-mounted-helpers';
import { recipientHash } from '../src/features/auth/mail';

setupRitewayBun();
configureAppEnvironment();

const mailbox = installMailbox();
const authRoute = await import('../src/app/api/auth/[...all]/route');
const confirmRoute = await import('../src/app/auth/confirm/route');
const webhookRoute = await import('../src/app/api/webhooks/resend/route');
const { getResources } = await import('../src/server/resources');

const secret = process.env.BETTER_AUTH_SECRET as string;
const emails: string[] = [];
const messageIds: string[] = [];
const fresh = () => {
  const email = fixtureEmail();
  emails.push(email);
  return email;
};

const sign = (id: string, timestamp: string, body: string) =>
  `v1,${createHmac('sha256', Buffer.from(webhookSecret.slice(6), 'base64'))
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64')}`;
/** A provider delivery exactly as Resend would sign it (payload holds the recipient). */
const providerEvent = (
  type: string,
  messageId: string,
  options: {
    eventId?: string;
    recipient?: string;
    bounceType?: string;
    createdAt?: string;
  } = {},
) => {
  const body = JSON.stringify({
    type,
    created_at: options.createdAt ?? new Date().toISOString(),
    data: {
      email_id: messageId,
      to: [options.recipient ?? 'recipient@example.test'],
      ...(options.bounceType ? { bounce: { type: options.bounceType } } : {}),
    },
  });
  const id = options.eventId ?? `evt_${createId()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Request('http://localhost:3000/api/webhooks/resend', {
    method: 'POST',
    headers: {
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': sign(id, timestamp, body),
      'content-type': 'application/json',
    },
    body,
  });
};

const requestLink = async (email: string) => {
  const before = mailbox.mails.length;
  const response = await authRoute.POST(
    jsonPost('/api/auth/sign-in/magic-link', { email }),
  );
  const mail = mailbox.mails[before];
  if (mail) messageIds.push(mail.messageId);
  return { response, mail };
};

const deliveryRow = (messageId: string) =>
  withSql(
    (sql) =>
      sql`SELECT status, status_rank, recipient_hash FROM email_delivery WHERE provider_message_id = ${messageId}`,
  );

afterAll(async () => {
  mailbox.restore();
  await withSql(async (sql) => {
    for (const id of messageIds) {
      await sql`DELETE FROM email_delivery_event WHERE provider_message_id = ${id}`;
      await sql`DELETE FROM email_delivery WHERE provider_message_id = ${id}`;
    }
    for (const email of emails)
      await sql`DELETE FROM email_suppression WHERE recipient_hash = ${recipientHash(secret, email)}`;
  });
  for (const email of emails) await removeAccount(email);
  await clearRedisNamespace();
  await getResources().database.close();
  getResources().redis.close();
});

describe('AUTH-3.6 provider delivery events', () => {
  test('a sent link records only the provider message ID and a keyed recipient hash', async () => {
    const email = fresh();
    const { response, mail } = await requestLink(email);
    const rows = await deliveryRow(mail?.messageId ?? '');
    const dump = await withSql(
      (sql) =>
        sql`SELECT (SELECT count(*) FROM email_delivery WHERE recipient_hash LIKE ${`%${email}%`})::int AS a`,
    );
    assert({
      given: 'a magic-link request delivered through the production sender',
      should:
        'store status "sent" with a SHA3 keyed hash of the recipient and never the address',
      actual: {
        status: response.status,
        row: rows[0]?.status,
        rank: rows[0]?.status_rank,
        hashMatches: rows[0]?.recipient_hash === recipientHash(secret, email),
        containsAddress: dump[0]?.a,
      },
      expected: {
        status: 200,
        row: 'sent',
        rank: 1,
        hashMatches: true,
        containsAddress: 0,
      },
    });
  });

  test('a signed delivered event updates status, keeps no payload data and never verifies or creates an account', async () => {
    const email = fresh();
    const { mail } = await requestLink(email);
    const messageId = mail?.messageId ?? '';
    const stranger = fresh();
    const response = await webhookRoute.POST(
      providerEvent('email.delivered', messageId, { recipient: stranger }),
    );
    const persisted = await withSql(async (sql) => ({
      events:
        await sql`SELECT * FROM email_delivery_event WHERE provider_message_id = ${messageId}`,
      leaks: await sql`SELECT (
        (SELECT count(*) FROM email_delivery_event WHERE provider_message_id::text || provider_event_id::text LIKE ${`%${stranger}%`}) +
        (SELECT count(*) FROM email_delivery WHERE recipient_hash LIKE ${`%${stranger}%`})
      )::int AS c`,
    }));
    assert({
      given:
        'a correctly signed delivered event whose payload names a recipient',
      should:
        'move the message to delivered, store id-only diagnostics and create no user or session',
      actual: {
        status: response.status,
        row: (await deliveryRow(messageId))[0]?.status,
        eventColumns: Object.keys(persisted.events[0] ?? {}).sort(),
        payloadLeak: persisted.leaks[0]?.c,
        strangerAccount: await counts(stranger),
        requesterAccount: await counts(email),
      },
      expected: {
        status: 200,
        row: 'delivered',
        eventColumns: [
          'provider_event_id',
          'provider_message_id',
          'received_at',
        ],
        payloadLeak: 0,
        strangerAccount: { users: 0, sessions: 0, verifications: 0 },
        requesterAccount: { users: 0, sessions: 0, verifications: 1 },
      },
    });
  });

  test('forged, tampered or unsigned webhooks change nothing', async () => {
    const email = fresh();
    const { mail } = await requestLink(email);
    const messageId = mail?.messageId ?? '';
    const forged = providerEvent('email.complained', messageId);
    const tamperedBody = JSON.stringify({
      type: 'email.complained',
      data: { email_id: messageId },
    });
    const responses = await Promise.all([
      webhookRoute.POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          headers: {
            'svix-id': 'evt_forged',
            'svix-timestamp': String(Math.floor(Date.now() / 1000)),
            'svix-signature': 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          },
          body: tamperedBody,
        }),
      ),
      webhookRoute.POST(
        new Request('http://localhost:3000/api/webhooks/resend', {
          method: 'POST',
          body: tamperedBody,
        }),
      ),
    ]);
    const forgedText = await forged.clone().text();
    assert({
      given: 'an invalid signature and an unsigned request',
      should:
        'reject both with 400 and leave delivery status and suppressions untouched',
      actual: {
        statuses: responses.map((response) => response.status),
        row: (await deliveryRow(messageId))[0]?.status,
        suppressed: await getResources().database.isRecipientSuppressed(
          recipientHash(secret, email),
        ),
        signedBodyHasType: forgedText.includes('email.complained'),
      },
      expected: {
        statuses: [400, 400],
        row: 'sent',
        suppressed: false,
        signedBodyHasType: true,
      },
    });
  });

  test('concurrently redelivered events apply once; late lower-ranked events never downgrade', async () => {
    const email = fresh();
    const { mail } = await requestLink(email);
    const messageId = mail?.messageId ?? '';
    const duplicate = `evt_${createId()}`;
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () =>
        webhookRoute.POST(
          providerEvent('email.delivery_delayed', messageId, {
            eventId: duplicate,
          }),
        ),
      ).map(
        async (pending) =>
          ((await (await pending).json()) as { status: string }).status,
      ),
    );
    // Out of order: the bounce is followed by an older "delivered".
    await webhookRoute.POST(
      providerEvent('email.bounced', messageId, { bounceType: 'Permanent' }),
    );
    await webhookRoute.POST(providerEvent('email.delivered', messageId));
    assert({
      given:
        'ten simultaneous copies of one event, then a bounce and a late delivered',
      should:
        'apply the duplicated event exactly once and keep the terminal bounced status',
      actual: {
        applied: outcomes.filter((outcome) => outcome === 'applied').length,
        duplicates: outcomes.filter((outcome) => outcome === 'duplicate')
          .length,
        eventRows: (
          await withSql(
            (sql) =>
              sql`SELECT count(*)::int AS c FROM email_delivery_event WHERE provider_event_id = ${duplicate}`,
          )
        )[0]?.c,
        finalStatus: (await deliveryRow(messageId))[0]?.status,
      },
      expected: {
        applied: 1,
        duplicates: 9,
        eventRows: 1,
        finalStatus: 'bounced',
      },
    });
  });

  test('a hard bounce stops automatic resends, keeps sessions and passkey access, and offers safe guidance', async () => {
    const email = fresh();
    const first = await requestLink(email);
    const token = linkFrom(first.mail as never).searchParams.get('token') ?? '';
    const signedIn = await confirmRoute.POST(
      formPost({ token, callbackURL: '/lobby' }),
    );
    await webhookRoute.POST(
      providerEvent('email.bounced', first.mail?.messageId ?? '', {
        bounceType: 'Permanent',
      }),
    );
    const before = mailbox.mails.length;
    const retry = await authRoute.POST(
      jsonPost('/api/auth/sign-in/magic-link', { email }),
    );
    const retryBody = (await retry.json()) as {
      code?: string;
      message?: string;
    };
    const viaForm = await confirmRoute.POST(
      formPost({ intent: 'resend', email, callbackURL: '/lobby' }),
    );
    const formHtml = await viaForm.text();
    assert({
      given: 'a permanent bounce for an address with an existing account',
      should:
        'refuse further sends with safe guidance (no loop), keep the account and its session and send nothing',
      actual: {
        signedInStatus: signedIn.status,
        retryStatus: retry.status,
        code: retryBody.code,
        guidance: /passkey/i.test(retryBody.message ?? ''),
        formStatus: viaForm.status,
        formGuidance: /passkey/i.test(formHtml),
        sent: mailbox.mails.length - before,
        account: await counts(email),
      },
      expected: {
        signedInStatus: 303,
        retryStatus: 422,
        code: 'EMAIL_UNDELIVERABLE',
        guidance: true,
        formStatus: 422,
        formGuidance: true,
        sent: 0,
        account: { users: 1, sessions: 1, verifications: 0 },
      },
    });
  });

  test('complaints suppress; transient bounces and delays do not', async () => {
    const complained = fresh();
    const transient = fresh();
    const a = await requestLink(complained);
    const b = await requestLink(transient);
    await webhookRoute.POST(
      providerEvent('email.complained', a.mail?.messageId ?? ''),
    );
    await webhookRoute.POST(
      providerEvent('email.bounced', b.mail?.messageId ?? '', {
        bounceType: 'Transient',
      }),
    );
    const again = await requestLink(transient);
    const blocked = await requestLink(complained);
    assert({
      given: 'a complaint for one address and a transient bounce for another',
      should: 'block only the complained address',
      actual: {
        transientResend: again.response.status,
        complaintResend: blocked.response.status,
      },
      expected: { transientResend: 200, complaintResend: 422 },
    });
  });

  test('an event racing its own send is retried and then applied; a stranger message is ignored', async () => {
    const messageId = `msg_race_${createId()}`;
    messageIds.push(messageId);
    const event = providerEvent('email.delivered', messageId, {
      eventId: `evt_${createId()}`,
    });
    const first = await webhookRoute.POST(event.clone());
    await getResources().database.recordEmailDelivery({
      providerMessageId: messageId,
      recipientHash: recipientHash(secret, fresh()),
      at: new Date().toISOString(),
    });
    const second = await webhookRoute.POST(event.clone());
    const stranger = await webhookRoute.POST(
      providerEvent('email.delivered', `msg_other_${createId()}`, {
        createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      }),
    );
    assert({
      given:
        'a delivered event before the send is recorded, the same event after, and an old event for a foreign message',
      should: '503 then applied, and the foreign one acknowledged and dropped',
      actual: {
        first: [first.status, first.headers.get('retry-after')],
        second: second.status,
        row: (await deliveryRow(messageId))[0]?.status,
        stranger: stranger.status,
      },
      expected: {
        first: [503, '5'],
        second: 200,
        row: 'delivered',
        stranger: 200,
      },
    });
  });
});
