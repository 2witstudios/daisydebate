import { afterAll } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { signJWT, verifyJWT } from 'better-auth/crypto';
import { buildUserInboxTopic } from '@daisy/protocol';
import { createPasskeyFlows } from './auth-passkey-flows';
import { trackedSignUp } from './auth-outbox-helpers';
import {
  cookieHeader,
  newClient,
  origin,
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
  withSql((sql) => sql`SELECT email FROM users WHERE id = ${userId}`).then(
    (rows) => rows[0]?.email as string | undefined,
  );

const userIdOf = (email: string) =>
  withSql((sql) => sql`SELECT id FROM users WHERE email = ${email}`).then(
    (rows) => rows[0]?.id as string | undefined,
  );

const { signUp, cleanup } = trackedSignUp(flows.account.signUp, userIdOf);
afterAll(cleanup);

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
});

// ISSUE-23's forced-outbox-failure test (real DB fault, session cookie,
// header surface and logging all proven together) lives in
// auth-email-change-atomicity-fault-injection.integration.ts, split out to
// stay under this file's line limit.
