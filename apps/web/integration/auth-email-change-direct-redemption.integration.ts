import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { createPasskeyFlows } from './auth-passkey-flows';
import {
  newClient,
  origin,
  withSql,
  type CapturedMail,
} from './auth-mounted-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

/**
 * ISSUE-3: split from `auth-email-change.integration.ts` to keep each file
 * under the lint's line limit. Proves the mounted `/api/auth` route refuses
 * to redeem `/verify-email` directly, so a linked-to change never completes
 * outside the same-origin confirm page.
 */
if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();

const flows = await createPasskeyFlows();
const { signUp } = flows.account;
const confirmEmailRoute = await import('../src/app/auth/confirm-email/route');

const linkFrom = (mail: CapturedMail): URL => {
  const found = mail.text.match(/https?:\/\/\S+/)?.[0];
  if (!found) throw new Error('No link in captured mail');
  return new URL(found);
};

const confirmPost = (token: string, callbackURL = '/settings/security') =>
  confirmEmailRoute.POST(
    new Request(`${origin}/auth/confirm-email`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin,
        [CLIENT_IP_HEADER]: newClient(),
      },
      body: new URLSearchParams({ token, callbackURL }).toString(),
    }),
  );

const tokenOf = (link: URL) => link.searchParams.get('token') ?? '';

const emailOf = (userId: string) =>
  withSql(async (sql) => {
    const [row] = await sql`SELECT email FROM users WHERE id = ${userId}`;
    return row?.email as string | undefined;
  });

const userIdOf = (email: string) =>
  withSql(async (sql) => {
    const [row] = await sql`SELECT id FROM users WHERE email = ${email}`;
    return row?.id as string | undefined;
  });

describe('ISSUE-3: direct GET redemption of /verify-email is refused', () => {
  test('a direct GET never verifies the change, leaving the token to verify through the confirm page', async () => {
    const { email, cookie } = await signUp();
    const uid = (await userIdOf(email)) ?? '';
    const before = flows.account.flows.mailbox.mails.length;
    const newEmail = `${createId()}@example.test`;
    await flows.changeEmail(cookie, newEmail);
    const confirmMail = flows.account.flows.mailbox.mails[before];
    await confirmPost(tokenOf(linkFrom(confirmMail!)));
    const verifyMail = flows.account.flows.mailbox.mails[before + 1];
    const verifyToken = tokenOf(linkFrom(verifyMail!));

    const direct = await flows.get(
      `/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`,
    );
    const emailAfterDirectAttempt = await emailOf(uid);
    const legitimate = await confirmPost(verifyToken);
    const finalEmail = await emailOf(uid);

    assert({
      given: 'a direct GET to the mounted /api/auth/verify-email link',
      should:
        'answer 404 with no cookie, changing nothing, and leave the token to verify normally afterward through the confirm page',
      actual: {
        directStatus: direct.status,
        directCookies: direct.headers.getSetCookie().length,
        emailAfterDirectAttempt,
        legitimateStatus: legitimate.status,
        finalEmail,
      },
      expected: {
        directStatus: 404,
        directCookies: 0,
        emailAfterDirectAttempt: email,
        legitimateStatus: 303,
        finalEmail: newEmail,
      },
    });
  });
});
