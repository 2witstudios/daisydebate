import { afterAll } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { signJWT, verifyJWT } from 'better-auth/crypto';
import { buildUserInboxTopic } from '@daisy/protocol';
import { createPasskeyFlows } from './auth-passkey-flows';
import { withOutboxInsertBlockedForTopic } from './auth-helpers';
import {
  cookieHeader,
  newClient,
  origin,
  testDatabaseUrl,
  withSql,
  type CapturedMail,
} from './auth-mounted-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';
import { EMAIL_VERIFICATION_EXPIRES_IN_SECONDS } from '../src/features/auth/server';

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
const { signUp: accountSignUp } = flows.account;
const confirmEmailRoute = await import('../src/app/auth/confirm-email/route');

/**
 * Every user id this suite's `signUp()` calls have created (RT-2.2f-r2:
 * these tests change the account's email mid-run, so cleanup keys on the
 * user id resolved at sign-up, never the original or final address).
 * `actors.user_id` is `onDelete: 'restrict'`, so actors are cleared before
 * their users; individual tests that create their own actor row clean it
 * up themselves, so this backstop is a no-op there.
 */
const suiteUserIds: string[] = [];

afterAll(async () => {
  await Promise.all(
    suiteUserIds.map((userId) =>
      withSql((sql) => sql`DELETE FROM actors WHERE user_id = ${userId}`),
    ),
  );
  await Promise.all(
    suiteUserIds.map((userId) =>
      withSql((sql) => sql`DELETE FROM users WHERE id = ${userId}`),
    ),
  );
});

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

/** Signs up and tracks the new user id for the `afterAll` cleanup above, before any test changes its email. */
const signUp = async () => {
  const result = await accountSignUp();
  const userId = await userIdOf(result.email);
  if (userId) suiteUserIds.push(userId);
  return result;
};

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

  test('the real second-hop verification token is minted with the configured lifetime', async () => {
    const { email, cookie } = await signUp();
    const before = flows.account.flows.mailbox.mails.length;
    const newEmail = `${createId()}@example.test`;
    await flows.changeEmail(cookie, newEmail);
    const confirmMail = flows.account.flows.mailbox.mails[before];
    await confirmPost(tokenOf(linkFrom(confirmMail!)));
    const verifyMail = flows.account.flows.mailbox.mails[before + 1];
    const verifyToken = tokenOf(linkFrom(verifyMail!));
    const secret = process.env.BETTER_AUTH_SECRET ?? '';
    const payload = await verifyJWT<{ iat: number; exp: number }>(
      verifyToken,
      secret,
    );
    assert({
      given:
        'a second-hop email-change verification token minted by the production `sendChangeEmailVerification` path (not self-forged)',
      should:
        "carry an exp - iat interval equal to the server's configured EMAIL_VERIFICATION_EXPIRES_IN_SECONDS",
      actual: (payload?.exp ?? 0) - (payload?.iat ?? 0),
      expected: EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
    });
    void email;
  });

  test("the atomic revocation's session.revoked append commits on the exact transaction that deleted the session", async () => {
    // RT-2.2v minor 1 (NC4): a unit test cannot tell `appendOutboxEvent(tx,
    // …)` apart from `appendOutboxEvent(database, …)` in
    // `revokeOtherSessions` — an awaited append that throws aborts the
    // caller's transaction either way. This proves the positive claim
    // directly: a fixture-scoped `BEFORE DELETE` trigger on `session`,
    // firing on the exact row the atomic revocation deletes, inserts a
    // marker outbox row from *inside that same statement's transaction*.
    // `outbox.txid` defaults to `pg_current_xact_id()` (`schema/outbox.ts`),
    // so the marker and the real `session.revoked` row carry the same txid
    // only if both inserts ran on the DELETE's own connection. Mutating the
    // source to `appendOutboxEvent(database, …)` moves that insert onto a
    // separate pooled connection with its own transaction id and turns this
    // red without needing any forced failure.
    const { email, cookie } = await signUp();
    const { requestLink, redeem } = flows.account.flows;
    const { link } = await requestLink(email);
    const otherToken = new URL(link as URL).searchParams.get('token') ?? '';
    await redeem(otherToken);
    const before = flows.account.flows.mailbox.mails.length;
    const newEmail = `${createId()}@example.test`;
    await flows.changeEmail(cookie, newEmail);
    const confirmMail = flows.account.flows.mailbox.mails[before];
    await confirmPost(tokenOf(linkFrom(confirmMail!)));
    const verifyMail = flows.account.flows.mailbox.mails[before + 1];
    const verifyToken = tokenOf(linkFrom(verifyMail!));

    const uid = (await userIdOf(email)) ?? '';
    const actorId = createId();
    await withSql(
      (sql) =>
        sql`INSERT INTO actors (id, kind, user_id) VALUES (${actorId}, 'human', ${uid})`,
    );

    const markerTopic = `test:xact-marker:${actorId}`;
    const fnName = `xact_marker_${createId()}`;
    await withSql((sql) =>
      sql.unsafe(`
        create function "${fnName}"() returns trigger as $body$
        begin
          if old.user_id = '${uid}' then
            insert into outbox (topic, kind, version, payload)
            values ('${markerTopic}', 'test.xact_marker', 1, '{}'::jsonb);
          end if;
          return old;
        end;
        $body$ language plpgsql
      `),
    );
    await withSql((sql) =>
      sql.unsafe(`
        create trigger "${fnName}_trigger" before delete on session
        for each row execute function "${fnName}"()
      `),
    );

    let completion: Response;
    try {
      completion = await confirmPost(verifyToken);
    } finally {
      await withSql((sql) =>
        sql.unsafe(`drop trigger if exists "${fnName}_trigger" on session`),
      );
      await withSql((sql) =>
        sql.unsafe(`drop function if exists "${fnName}"()`),
      );
    }

    const [markerRow] = await withSql(
      (sql) =>
        sql`select txid::text as txid from outbox where topic = ${markerTopic}`,
    );
    const [revokedRow] = await withSql(
      (sql) =>
        sql`select txid::text as txid from outbox where topic = ${buildUserInboxTopic(actorId)} and kind = 'session.revoked'`,
    );
    await withSql(
      (sql) => sql`delete from outbox where topic = ${markerTopic}`,
    );
    await withSql(
      (sql) =>
        sql`delete from outbox where topic = ${buildUserInboxTopic(actorId)}`,
    );
    await withSql((sql) => sql`delete from actors where id = ${actorId}`);

    assert({
      given:
        "the atomic revocation's session.revoked append and a fixture trigger that marks the DELETE's own transaction",
      should:
        'complete the change and record both inserts on the exact same Postgres transaction',
      actual: {
        completionStatus: completion.status,
        markerRowFound: markerRow !== undefined,
        revokedRowFound: revokedRow !== undefined,
        sameTransaction: markerRow?.txid === revokedRow?.txid,
      },
      expected: {
        completionStatus: 303,
        markerRowFound: true,
        revokedRowFound: true,
        sameTransaction: true,
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

  test('a forced outbox failure inside the atomic revocation rolls back the session delete too', async () => {
    const { email, cookie } = await signUp();
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

    // Same real-fault technique as `auth-session-revoked-outbox.integration.ts`:
    // a topic-scoped `BEFORE INSERT` trigger is a genuine Postgres-level
    // failure of the exact statement `appendOutboxEvent` issues, never a
    // stub of the function under test, and (RT-2.2v minor 3) never blocks
    // the `@daisy/db` integration suite's own outbox inserts running
    // concurrently against the same `TEST_DATABASE_URL`. Revision 4.7's
    // contract is that this path is atomic, unlike the best-effort
    // after-hooks: the DELETE must roll back with it.
    let completion!: Response;
    try {
      await withOutboxInsertBlockedForTopic(
        testDatabaseUrl as string,
        buildUserInboxTopic(actorId),
        async () => {
          completion = await confirmPost(verifyToken);
        },
      );

      assert({
        given:
          "the atomic revocation's outbox append failing at the database level",
        should:
          'report the cleanup step failed and leave the other session still authenticated, proving the DELETE rolled back with it',
        actual: {
          status: completion.status,
          otherSessionStillAuthenticated: await isAuthenticated(otherCookie),
        },
        expected: { status: 502, otherSessionStillAuthenticated: true },
      });
    } finally {
      // RT-2.2f-r1 minor: this fixture inserts the actor directly (above),
      // so it must clean it — and the account's `users` row, RESTRICTed
      // behind it — itself; no shared afterAll in this file does either.
      // Better Auth's own second-hop verification already commits the
      // email to `newEmail` before Daisy's atomic revocation ever runs (the
      // 502 this test proves is only the "cleanup step", not the change
      // itself), so cleanup must key off `uid`/`actorId`, never the
      // pre-change `email` `removeAccount` matches on.
      await withSql((sql) => sql`DELETE FROM actors WHERE id = ${actorId}`);
      await withSql((sql) => sql`DELETE FROM users WHERE id = ${uid}`);
    }
  });
});
