import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { buildUserInboxTopic } from '@daisy/protocol';
import { createPasskeyFlows } from './auth-passkey-flows';
import { withOutboxInsertBlockedForTopic } from './auth-helpers';
import {
  cookieHeader,
  newClient,
  origin,
  testDatabaseUrl,
  withLoggedEvents,
  withSql,
  type CapturedMail,
} from './auth-mounted-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

/**
 * ISSUE-23: the after-hook revoke-other-sessions failure path on
 * /verify-email was previously proven only by a rejecting stub
 * (revoke-others-on-verify-email.test.ts) or a fake handler that set the
 * header directly (confirm-email.test.ts). This forces a real database
 * fault into a live /verify-email redemption, through the confirm page
 * (per ISSUE-3 AC4), the same real-fault technique
 * auth-session-revoked-outbox.integration.ts uses: a topic-scoped
 * `BEFORE INSERT` trigger is a genuine Postgres-level failure of the exact
 * statement `appendOutboxEvent` issues, never a stub of the function under
 * test, and never blocks the `@daisy/db` integration suite's own outbox
 * inserts running concurrently against the same `TEST_DATABASE_URL`.
 */
if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();

const flows = await createPasskeyFlows();
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

const userIdOf = (email: string) =>
  withSql((sql) => sql`SELECT id FROM users WHERE email = ${email}`).then(
    (rows) => rows[0]?.id as string | undefined,
  );

describe('ISSUE-23 a real fault injected into revokeOtherSessions during /verify-email', () => {
  test('a forced outbox failure inside the atomic revocation rolls back the session delete too', async () => {
    const { email, cookie } = await flows.account.signUp();
    const { requestLink, redeem } = flows.account.flows;
    const { link } = await requestLink(email);
    const otherToken = new URL(link as URL).searchParams.get('token') ?? '';
    const otherCookie = cookieHeader(await redeem(otherToken));
    const before = flows.account.flows.mailbox.mails.length;
    const newEmail = `${createId()}@example.test`;
    await flows.changeEmail(cookie, newEmail);
    const confirmMail = flows.account.flows.mailbox.mails[before];
    await confirmPost(tokenOf(linkFrom(confirmMail!)));
    const verifyMail = flows.account.flows.mailbox.mails[before + 1];
    const verifyToken = tokenOf(linkFrom(verifyMail!));

    // Plan revision 4.10: the append only runs once the actor resolves.
    // This account never claims a username (an unrelated surface to the
    // atomic revocation under test), so it inserts the actor directly
    // rather than going through the onboarding route.
    const uid = await userIdOf(email);
    const actorId = createId();
    await withSql(
      (sql) =>
        sql`INSERT INTO actors (id, kind, user_id) VALUES (${actorId}, 'human', ${uid})`,
    );

    let completion!: Response;
    let loggedEvents: readonly string[] = [];
    try {
      ({ events: loggedEvents } = await withLoggedEvents(() =>
        withOutboxInsertBlockedForTopic(
          testDatabaseUrl as string,
          buildUserInboxTopic(actorId),
          async () => {
            completion = await confirmPost(verifyToken);
          },
        ),
      ));

      assert({
        given:
          "the atomic revocation's outbox append failing at the database level",
        should:
          'report the cleanup step failed, still carry the new session cookie, leave the other session authenticated (the DELETE rolled back with it), and log the cleanup-failed event',
        actual: {
          status: completion.status,
          carriesNewSessionCookie: completion.headers.getSetCookie().length > 0,
          otherSessionStillAuthenticated: await isAuthenticated(otherCookie),
          loggedCleanupFailed: loggedEvents.includes(
            'auth.email_change.cleanup_failed',
          ),
        },
        expected: {
          status: 502,
          carriesNewSessionCookie: true,
          otherSessionStillAuthenticated: true,
          loggedCleanupFailed: true,
        },
      });
    } finally {
      // This test's own accounts and actor are cleaned up here: no shared
      // afterAll backstop in this single-test file.
      await withSql((sql) => sql`DELETE FROM actors WHERE id = ${actorId}`);
      await withSql(
        (sql) => sql`DELETE FROM users WHERE email IN (${email}, ${newEmail})`,
      );
    }
  });
});
