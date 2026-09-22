import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { signJWT } from 'better-auth/crypto';
import { createPasskeyFlows } from './auth-passkey-flows';
import {
  cookieHeader,
  newClient,
  origin,
  withSql,
  type CapturedMail,
} from './auth-mounted-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

/**
 * Stage 5 review follow-ups for AUTH-5.6: expired verification tokens and
 * the atomic other-session revocation, split from
 * `auth-email-change.integration.ts` to keep each file under the lint's
 * line limit.
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

const isAuthenticated = async (cookie: string): Promise<boolean> =>
  (await (
    await flows.get('/api/auth/get-session?disableCookieCache=true', cookie)
  ).json()) !== null;

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

describe('AUTH-5.6 change the recovery email: expiry and atomic revocation', () => {
  test('an expired verification token is rejected server-side and changes nothing', async () => {
    const { email } = await signUp();
    const uid = (await userIdOf(email)) ?? '';
    const newEmail = `${createId()}@example.test`;
    const secret = process.env.BETTER_AUTH_SECRET ?? '';
    const payload = {
      email,
      updateTo: newEmail,
      requestType: 'change-email-verification',
    };
    // Same signing routine and secret the real handler uses
    // (`better-auth/crypto`'s `signJWT`, HS256) — only the expiry differs,
    // isolating the expiry check from every other rejection reason.
    const expiredToken = await signJWT(payload, secret, -60);
    const validToken = await signJWT(payload, secret, 60);
    const expiredAttempt = await confirmPost(expiredToken);
    const emailAfterExpired = await emailOf(uid);
    const validAttempt = await confirmPost(validToken);
    assert({
      given:
        'a correctly signed but already-expired email-change verification token, next to an equivalent unexpired one',
      should:
        'reject the expired token and leave the account on its original address, while the unexpired token still succeeds',
      actual: {
        expiredStatus: expiredAttempt.status,
        emailAfterExpired,
        validStatus: validAttempt.status,
        emailAfterValid: await emailOf(uid),
      },
      expected: {
        expiredStatus: 400,
        emailAfterExpired: email,
        validStatus: 303,
        emailAfterValid: newEmail,
      },
    });
  });

  test('a session committed while the completion is still in flight does not survive the atomic revocation', async () => {
    const { email, cookie } = await signUp();
    const { requestLink, redeem, getResources } = flows.account.flows;
    const { link } = await requestLink(email);
    const concurrentToken =
      new URL(link as URL).searchParams.get('token') ?? '';
    const before = flows.account.flows.mailbox.mails.length;
    const newEmail = `${createId()}@example.test`;
    await flows.changeEmail(cookie, newEmail);
    const confirmMail = flows.account.flows.mailbox.mails[before];
    await confirmPost(tokenOf(linkFrom(confirmMail!)));
    const verifyMail = flows.account.flows.mailbox.mails[before + 1];
    const verifyToken = tokenOf(linkFrom(verifyMail!));

    // A bare `Promise.all` race is nondeterministic about which pipeline
    // reaches the database first, so asserting on it either way would be
    // flaky. This pins the interleaving that matters — the concurrent
    // sign-in's session fully committed while the completion request is
    // still in flight — by holding the real `revokeOtherSessions` call
    // (still the genuine atomic DELETE against real Postgres, not a stub;
    // only its start is delayed) until that sign-in's response resolves.
    // The regression guard for the snapshot-then-delete shape itself is
    // `packages/db/src/index.test.ts`'s "one atomic statement" unit test,
    // which fails the moment a listing query reappears; this test proves
    // the operational behavior that atomicity buys, against real services.
    const { database } = getResources();
    const realRevoke = database.revokeOtherSessions.bind(database);
    let releaseRevoke = () => {};
    const revokeMayProceed = new Promise<void>((resolve) => {
      releaseRevoke = resolve;
    });
    database.revokeOtherSessions = async (
      userId: string,
      keepToken: string,
    ) => {
      await revokeMayProceed;
      return realRevoke(userId, keepToken);
    };
    try {
      const [concurrentSignIn, completion] = await Promise.all([
        redeem(concurrentToken).then((response) => {
          releaseRevoke();
          return response;
        }),
        confirmPost(verifyToken),
      ]);
      const concurrentCookie = cookieHeader(concurrentSignIn);

      assert({
        given:
          "a brand-new sign-in that finishes committing its session while the email-change completion's atomic revocation is still in flight",
        should: 'complete the change and revoke that sign-in anyway',
        actual: {
          completionRedirected: completion.status,
          concurrentSessionIssued: concurrentCookie.length > 0,
          concurrentSessionAuthenticated:
            await isAuthenticated(concurrentCookie),
        },
        expected: {
          completionRedirected: 303,
          concurrentSessionIssued: true,
          concurrentSessionAuthenticated: false,
        },
      });
    } finally {
      database.revokeOtherSessions = realRevoke;
    }
  });
});
