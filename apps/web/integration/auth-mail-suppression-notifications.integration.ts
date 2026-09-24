import { afterAll } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { createPasskeyFlows } from './auth-passkey-flows';
import { providerEvent } from './auth-webhook-helpers';
import { linkFrom, tokenOf, withSql } from './fixtures';
import {
  deriveRecipientSubkey,
  recipientKey,
} from '../src/features/auth/recipient-key';
import { requireTestServices } from '@daisy/config';

/**
 * ISSUE-54 AC1: every auth mail goes through the one delivery path, and
 * that path honours suppression (ADR 0025). Before, only the sign-in link
 * checked it: the passkey notices and the email-change mails went straight
 * to the transport, so a hard-bounced or complained address kept receiving
 * them.
 */
requireTestServices(process.env);
setupRitewayBun();

const flows = await createPasskeyFlows();
const { signUp } = flows.account;
const { testApp, mailbox } = flows.account.flows;
const subkey = deriveRecipientSubkey(testApp.env.BETTER_AUTH_SECRET);
const suppressedAddresses: string[] = [];
const messageIds: string[] = [];

afterAll(async () => {
  await withSql(async (sql) => {
    for (const id of messageIds) {
      await sql`DELETE FROM email_delivery_event WHERE provider_message_id = ${id}`;
      await sql`DELETE FROM email_delivery WHERE provider_message_id = ${id}`;
    }
    for (const email of suppressedAddresses)
      await sql`DELETE FROM email_suppression WHERE recipient_hash = ${recipientKey(subkey, email)}`;
  });
});

/** A real permanent bounce, through the signed webhook, for a mail sent to `email`. */
const hardBounce = async (email: string) => {
  const mail = mailbox.mails.filter((sent) => sent.to === email).at(-1);
  if (!mail) throw new Error('no mail was sent to that address');
  messageIds.push(mail.messageId);
  suppressedAddresses.push(email);
  const response = await testApp.routes.mailWebhook.POST(
    providerEvent('email.bounced', mail.messageId, {
      bounceType: 'Permanent',
    }),
  );
  if (!response.ok) throw new Error(`webhook refused: ${response.status}`);
};

const mailsTo = (email: string, from: number) =>
  mailbox.mails.slice(from).filter((mail) => mail.to === email).length;

describe('ISSUE-54 notifications honour suppression', () => {
  test('a passkey added to an account whose address hard-bounced sends no notice', async () => {
    const { email, cookie } = await signUp();
    await hardBounce(email);
    const before = mailbox.mails.length;
    const { verifyResponse } = await flows.enrollPasskey(cookie, {
      name: 'Bounced phone',
    });
    const events = await flows.recordedEvents(async () => {
      const { verifyResponse: second } = await flows.enrollPasskey(cookie, {
        name: 'Bounced key',
      });
      await second.body?.cancel();
    });
    assert({
      given:
        'a suppressed account address and a real passkey registration, twice',
      should:
        'complete the registration, send nothing to the suppressed address and log the skipped send, never a failure',
      actual: {
        enrolled: verifyResponse.status,
        sent: mailsTo(email, before),
        suppressedLogged: events.includes('auth.mail.suppressed'),
        failureLogged: events.includes('auth.passkey.notification_failed'),
      },
      expected: {
        enrolled: 200,
        sent: 0,
        suppressedLogged: true,
        failureLogged: false,
      },
    });
  });

  test('an email change requested from a suppressed address sends nothing and says why', async () => {
    const { email, cookie } = await signUp();
    await hardBounce(email);
    const before = mailbox.mails.length;
    const response = await flows.changeEmail(
      cookie,
      `${createId()}@example.test`,
    );
    const body = (await response.json()) as { code?: string };
    assert({
      given: 'a signed-in account whose current address hard-bounced',
      should:
        'refuse the change with EMAIL_UNDELIVERABLE and send no approval notice',
      actual: {
        status: response.status,
        code: body.code,
        sent: mailbox.mails.length - before,
      },
      expected: { status: 422, code: 'EMAIL_UNDELIVERABLE', sent: 0 },
    });
  });

  test('an email change to a suppressed new address never mails its confirmation there', async () => {
    const { email, cookie } = await signUp();
    // The new address hard-bounced a sign-in link mailed to it earlier.
    const newEmail = testApp.freshEmail();
    await flows.account.flows.requestLink(newEmail);
    await hardBounce(newEmail);
    const before = mailbox.mails.length;
    const requested = await flows.changeEmail(cookie, newEmail);
    const notice = mailbox.mails[before];
    const approved = await flows.confirmEmailPost(
      notice ? tokenOf(linkFrom(notice)) : '',
    );
    assert({
      given:
        'an email change to an address that hard-bounced, approved from the current address',
      should:
        'mail the approval notice to the current address, then refuse the approval without mailing the suppressed new address',
      actual: {
        requestStatus: requested.status,
        noticeTo: notice?.to,
        approvedStatus: approved.status,
        sentToSuppressed: mailsTo(newEmail, before),
      },
      expected: {
        requestStatus: 200,
        noticeTo: email,
        approvedStatus: 400,
        sentToSuppressed: 0,
      },
    });
  });
});
