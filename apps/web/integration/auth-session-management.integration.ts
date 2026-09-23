import { afterAll } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { buildUserInboxTopic } from '@daisy/protocol';
import { createPasskeyFlows } from './auth-passkey-flows';
import {
  cookieHeader,
  newClient,
  origin,
  withSql,
} from './auth-mounted-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

/**
 * Plan revision 4.10: the outbox append only runs once the actor resolves
 * through `actors.user_id`, and this suite's accounts sign up without ever
 * claiming a username (an unrelated surface to session revocation), so it
 * inserts the actor directly rather than going through the onboarding
 * route. Revocation rows are keyed by `actors.id`, never `userId`, so this
 * returns the actor id the append will use.
 */
const createActorFor = async (userId: string): Promise<string> => {
  const actorId = createId();
  await withSql(
    (sql) =>
      sql`INSERT INTO actors (id, kind, user_id) VALUES (${actorId}, 'human', ${userId})`,
  );
  return actorId;
};

const cleanupActorFor = (userId: string) =>
  withSql((sql) => sql`DELETE FROM actors WHERE user_id = ${userId}`);

/** RT-2.2: outbox rows the session-revocation hooks append for this actor. */
const sessionRevokedEvents = (actorId: string) =>
  withSql(
    (sql) =>
      sql`SELECT topic FROM outbox WHERE kind = 'session.revoked' AND topic = ${buildUserInboxTopic(actorId)}`,
  ).then((rows) => rows.length);

/** Fixture teardown: never leave session.revoked rows behind for this actor. */
const cleanupOutboxFor = (actorId: string) =>
  withSql(
    (sql) =>
      sql`DELETE FROM outbox WHERE kind = 'session.revoked' AND topic = ${buildUserInboxTopic(actorId)}`,
  );

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();

const suiteStartedAt = new Date().toISOString();
// Backstop for the per-test cleanups above: whatever this file's tests
// appended and did not individually clean up (never a real, wider sweep;
// scoped to rows this suite could plausibly have created).
afterAll(() =>
  withSql(
    (sql) =>
      sql`DELETE FROM outbox WHERE kind = 'session.revoked' AND created_at >= ${suiteStartedAt}::timestamptz`,
  ),
);

const flows = await createPasskeyFlows();
const { signUp } = flows.account;
const { authRoute } = flows;

/** Reads the current session with cookie caching disabled, as production does. */
const protectedRead = (cookie: string) =>
  authRoute.GET(
    new Request(`${origin}/api/auth/get-session?disableCookieCache=true`, {
      headers: { cookie, [CLIENT_IP_HEADER]: newClient() },
    }),
  );

/**
 * An ordinary `/get-session` call with no per-request cache bypass — what
 * every caller other than this suite's own explicit checks actually sends.
 * Its freshness depends entirely on the server's own
 * `session.cookieCache: { enabled: false }` (`server.ts`), not on any
 * request-side opt-out.
 */
const plainRead = (cookie: string) =>
  authRoute.GET(
    new Request(`${origin}/api/auth/get-session`, {
      headers: { cookie, [CLIENT_IP_HEADER]: newClient() },
    }),
  );

/**
 * `/get-session` always answers 200; a revoked, expired or absent session is
 * a `null` body, not an error status, so the live signal is the body itself.
 */
const isAuthenticated = async (response: Response): Promise<boolean> =>
  (await response.clone().json()) !== null;

const sessionTokenOf = async (response: Response): Promise<string> =>
  ((await response.clone().json()) as { session?: { token: string } } | null)
    ?.session?.token ?? '';

const sessionUserIdOf = async (response: Response): Promise<string> =>
  ((await response.clone().json()) as { session?: { userId: string } } | null)
    ?.session?.userId ?? '';

describe('AUTH-5.5 session management', () => {
  test('a second sign-in creates a second session, both listed for the account', async () => {
    const { email, cookie: first } = await signUp();
    const { requestLink, redeem } = flows.account.flows;
    await requestLink(email);
    // A second real magic-link sign-in for the same account: a genuinely
    // independent session, not a fixture.
    const { link } = await requestLink(email);
    const token = new URL(link as URL).searchParams.get('token') ?? '';
    await redeem(token);
    const listed = await flows.listSessions(first);
    const rows = (await listed.json()) as { token: string }[];
    assert({
      given: 'one account signed in twice',
      should: 'list two distinct active sessions',
      actual: {
        count: rows.length,
        distinctTokens: new Set(rows.map((r) => r.token)).size,
      },
      expected: { count: 2, distinctTokens: 2 },
    });
  });

  test('revoking a specific other session denies its next protected request, with cookie caching disabled', async () => {
    const { email, cookie: first } = await signUp();
    const { requestLink, redeem } = flows.account.flows;
    const { link } = await requestLink(email);
    const token = new URL(link as URL).searchParams.get('token') ?? '';
    const second = cookieHeader(await redeem(token));
    const before = await protectedRead(second);
    const secondToken = await sessionTokenOf(before);
    const userId = await sessionUserIdOf(before);
    const actorId = await createActorFor(userId);
    const eventsBefore = await sessionRevokedEvents(actorId);
    try {
      await flows.revokeSession(first, secondToken);
      const after = await protectedRead(second);
      assert({
        given: 'a named other session revoked from the current one',
        should:
          'let the first request through, deny the next with a fresh (non-cached) read, and append session.revoked to the outbox (RT-2.2)',
        actual: {
          beforeAuthenticated: await isAuthenticated(before),
          afterAuthenticated: await isAuthenticated(after),
          outboxEventsAppended:
            (await sessionRevokedEvents(actorId)) - eventsBefore,
        },
        expected: {
          beforeAuthenticated: true,
          afterAuthenticated: false,
          outboxEventsAppended: 1,
        },
      });
    } finally {
      await cleanupOutboxFor(actorId);
      await cleanupActorFor(userId);
    }
  });

  test('a revoked session is denied even by an ordinary read that never asked to bypass the cache', async () => {
    const { email, cookie: first } = await signUp();
    const { requestLink, redeem } = flows.account.flows;
    const { link } = await requestLink(email);
    const token = new URL(link as URL).searchParams.get('token') ?? '';
    const second = cookieHeader(await redeem(token));
    const before = await plainRead(second);
    const secondToken = await sessionTokenOf(before);
    await flows.revokeSession(first, secondToken);
    const after = await plainRead(second);
    assert({
      given:
        'a named other session revoked, then read back with no `disableCookieCache` opt-out',
      should:
        "deny it anyway — the server's own cookieCache:{enabled:false} setting, not the caller, is what keeps this fresh",
      actual: {
        beforeAuthenticated: await isAuthenticated(before),
        afterAuthenticated: await isAuthenticated(after),
      },
      expected: { beforeAuthenticated: true, afterAuthenticated: false },
    });
  });

  test('revoking other sessions leaves the current session usable and every other one denied', async () => {
    const { email, cookie: first } = await signUp();
    const { requestLink, redeem } = flows.account.flows;
    const { link: link1 } = await requestLink(email);
    const secondCookie = cookieHeader(
      await redeem(new URL(link1 as URL).searchParams.get('token') ?? ''),
    );
    const { link: link2 } = await requestLink(email);
    const thirdCookie = cookieHeader(
      await redeem(new URL(link2 as URL).searchParams.get('token') ?? ''),
    );
    const userId = await sessionUserIdOf(await protectedRead(first));
    const actorId = await createActorFor(userId);
    const eventsBefore = await sessionRevokedEvents(actorId);
    try {
      const revoke = await flows.revokeOtherSessions(first);
      const [currentAfter, secondAfter, thirdAfter] = await Promise.all([
        protectedRead(first),
        protectedRead(secondCookie),
        protectedRead(thirdCookie),
      ]);
      assert({
        given: 'revoke-other-sessions called from the first session',
        should:
          'keep the calling session live, deny every other one, and append one session.revoked doorbell for the call (RT-2.2)',
        actual: {
          revoked: revoke.ok,
          current: await isAuthenticated(currentAfter),
          second: await isAuthenticated(secondAfter),
          third: await isAuthenticated(thirdAfter),
          outboxEventsAppended:
            (await sessionRevokedEvents(actorId)) - eventsBefore,
        },
        expected: {
          revoked: true,
          current: true,
          second: false,
          third: false,
          outboxEventsAppended: 1,
        },
      });
    } finally {
      await cleanupOutboxFor(actorId);
      await cleanupActorFor(userId);
    }
  });

  test("revoking every session (including the caller's own) denies it too, and appends one session.revoked doorbell for the call (RT-2.2)", async () => {
    const { email, cookie: first } = await signUp();
    const { requestLink, redeem } = flows.account.flows;
    const { link } = await requestLink(email);
    const secondCookie = cookieHeader(
      await redeem(new URL(link as URL).searchParams.get('token') ?? ''),
    );
    const userId = await sessionUserIdOf(await protectedRead(first));
    const actorId = await createActorFor(userId);
    const eventsBefore = await sessionRevokedEvents(actorId);
    try {
      const revoke = await flows.revokeSessions(first);
      const [firstAfter, secondAfter] = await Promise.all([
        protectedRead(first),
        protectedRead(secondCookie),
      ]);
      assert({
        given: 'revoke-sessions (revoke-all) called from the first session',
        should:
          'deny the calling session too, deny every other one, and append one session.revoked doorbell for the call (RT-2.2)',
        actual: {
          revoked: revoke.ok,
          first: await isAuthenticated(firstAfter),
          second: await isAuthenticated(secondAfter),
          outboxEventsAppended:
            (await sessionRevokedEvents(actorId)) - eventsBefore,
        },
        expected: {
          revoked: true,
          first: false,
          second: false,
          outboxEventsAppended: 1,
        },
      });
    } finally {
      await cleanupOutboxFor(actorId);
      await cleanupActorFor(userId);
    }
  });

  // Better Auth answers 200/{status:true} for a foreign token too, so an
  // attacker cannot use the response to learn whether a token exists; the
  // only observable, security-relevant fact is that nothing was revoked.
  test("another user's session token does not revoke it", async () => {
    const alice = await signUp();
    const bob = await signUp();
    const bobToken = await sessionTokenOf(await protectedRead(bob.cookie));
    await flows.revokeSession(alice.cookie, bobToken);
    const stillLive = await protectedRead(bob.cookie);
    assert({
      given: "alice naming bob's session token",
      should: "leave bob's session live",
      actual: await isAuthenticated(stillLive),
      expected: true,
    });
  });

  test('an anonymous request is refused for revoking sessions', async () => {
    const anonymous = await flows.revokeSessions('');
    assert({
      given: 'no session cookie at all',
      should: 'refuse the revocation',
      actual: anonymous.ok,
      expected: false,
    });
  });
});
