import { createHmac } from 'node:crypto';
import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import {
  clearRedisNamespace,
  configureAppEnvironment,
  fixtureEmail,
  installMailbox,
  jsonPost,
  removeAccount,
  webhookSecret,
  withSql,
} from './auth-mounted-helpers';
import { recipientHash } from '../src/features/auth/mail';

const sign = (id: string, timestamp: string, body: string) =>
  `v1,${createHmac('sha256', Buffer.from(webhookSecret.slice(6), 'base64'))
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64')}`;

/** A provider delivery exactly as Resend would sign it (payload holds the recipient). */
export const providerEvent = (
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

export const deliveryRow = (messageId: string) =>
  withSql(
    (sql) =>
      sql`SELECT status, status_rank, recipient_hash FROM email_delivery WHERE provider_message_id = ${messageId}`,
  );

/**
 * One mounted-route suite over real PostgreSQL/Redis with a private mailbox.
 * Registers its own cleanup: only records this suite created are removed.
 */
export async function createMailSuite() {
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
  const requestLink = async (email: string) => {
    const before = mailbox.mails.length;
    const response = await authRoute.POST(
      jsonPost('/api/auth/sign-in/magic-link', { email }),
    );
    const mail = mailbox.mails[before];
    if (mail) messageIds.push(mail.messageId);
    return { response, mail };
  };
  afterAll(async () => {
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
  });
  return {
    mailbox,
    authRoute,
    confirmRoute,
    webhookRoute,
    getResources,
    secret,
    messageIds,
    fresh,
    requestLink,
  };
}
