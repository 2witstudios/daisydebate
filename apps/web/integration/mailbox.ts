import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { resendRequest } from '../src/features/auth/resend-capture.test-support';

type CapturedMail = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly idempotencyKey: string;
  readonly messageId: string;
};

/**
 * A private mailbox: its `fetch` answers the Resend endpoint by capturing
 * what the production sender puts on the wire, and passes anything else to
 * the network. Nothing process-wide is replaced.
 */
export function createMailbox() {
  const mails: CapturedMail[] = [];
  const failures: Array<'transient' | 'permanent'> = [];
  // Every message id this mailbox issues starts with it (see removeMailRecords).
  const messagePrefix = `msg_${createId().slice(0, 8)}_`;
  let counter = 0;
  const mailboxFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const sent = resendRequest(input, init);
    if (!sent) return fetch(input, init);
    const failure = failures.shift();
    if (failure === 'transient')
      return new Response('{"message":"upstream boom for someone@x.test"}', {
        status: 503,
      });
    if (failure === 'permanent') return new Response('{}', { status: 422 });
    counter += 1;
    const messageId = `${messagePrefix}${counter}`;
    mails.push({ ...sent, messageId });
    return Response.json({ id: messageId });
  };
  return {
    mails,
    messagePrefix,
    fetch: mailboxFetch,
    failNext: (...kinds: Array<'transient' | 'permanent'>) =>
      failures.push(...kinds),
  };
}

/**
 * Removes the delivery rows the app recorded for this mailbox's messages:
 * delivery state, webhook events and suppressions, all keyed by the
 * provider message id the mailbox issued. ISSUE-192: without this each run
 * left its email_delivery rows behind (about 4,000 per full run), and the
 * growing table slowed every later run.
 */
export async function removeMailRecords(
  sql: SQL,
  { messagePrefix }: { readonly messagePrefix: string },
) {
  for (const table of [
    'email_delivery_event',
    'email_delivery',
    'email_suppression',
  ])
    await sql`DELETE FROM ${sql(table)} WHERE starts_with(provider_message_id, ${messagePrefix})`;
}
