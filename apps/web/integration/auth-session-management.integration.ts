import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createPasskeyFlows } from './auth-passkey-flows';
import {
  cookieHeader,
  newClient,
  origin,
  withSql,
} from './auth-mounted-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

/** Backdates a session row's createdAt so the fresh-session gate refuses it. */
const backdateSession = (token: string, hoursAgo: number) =>
  withSql(
    (sql) =>
      sql`UPDATE session SET created_at = now() - (${hoursAgo}::text || ' hours')::interval WHERE token = ${token}`,
  );

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();

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
 * `/get-session` always answers 200; a revoked, expired or absent session is
 * a `null` body, not an error status, so the live signal is the body itself.
 */
const isAuthenticated = async (response: Response): Promise<boolean> =>
  (await response.clone().json()) !== null;

const sessionTokenOf = async (response: Response): Promise<string> =>
  ((await response.clone().json()) as { session?: { token: string } } | null)
    ?.session?.token ?? '';

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
    await flows.revokeSession(first, secondToken);
    const after = await protectedRead(second);
    assert({
      given: 'a named other session revoked from the current one',
      should:
        'let the first request through and deny the next with a fresh (non-cached) read',
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
    const revoke = await flows.revokeOtherSessions(first);
    const [currentAfter, secondAfter, thirdAfter] = await Promise.all([
      protectedRead(first),
      protectedRead(secondCookie),
      protectedRead(thirdCookie),
    ]);
    assert({
      given: 'revoke-other-sessions called from the first session',
      should: 'keep the calling session live and deny every other one',
      actual: {
        revoked: revoke.ok,
        current: await isAuthenticated(currentAfter),
        second: await isAuthenticated(secondAfter),
        third: await isAuthenticated(thirdAfter),
      },
      expected: { revoked: true, current: true, second: false, third: false },
    });
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

  test('a stale session is refused for revoking sessions and requires fresh authentication', async () => {
    const { cookie } = await signUp();
    const sessionBody = (await (await protectedRead(cookie)).json()) as {
      session?: { token: string };
    };
    const token = sessionBody.session?.token ?? '';
    await backdateSession(token, 2);
    const stale = await flows.revokeSessions(cookie);
    assert({
      given: 'a live, valid session created outside the fresh window',
      should: 'refuse revoke-sessions and require fresh authentication',
      actual: { ok: stale.ok, status: stale.status },
      expected: { ok: false, status: 403 },
    });
  });

  test('a stale session is refused for revoking a single other session', async () => {
    const { cookie } = await signUp();
    const sessionBody = (await (await protectedRead(cookie)).json()) as {
      session?: { token: string };
    };
    const token = sessionBody.session?.token ?? '';
    await backdateSession(token, 2);
    const stale = await flows.revokeSession(cookie, 'irrelevant-token');
    assert({
      given: 'a live, valid session created outside the fresh window',
      should: 'refuse revoke-session and require fresh authentication',
      actual: { ok: stale.ok, status: stale.status },
      expected: { ok: false, status: 403 },
    });
  });

  test('a stale session is refused for revoking every other session', async () => {
    const { cookie } = await signUp();
    const sessionBody = (await (await protectedRead(cookie)).json()) as {
      session?: { token: string };
    };
    const token = sessionBody.session?.token ?? '';
    await backdateSession(token, 2);
    const stale = await flows.revokeOtherSessions(cookie);
    assert({
      given: 'a live, valid session created outside the fresh window',
      should: 'refuse revoke-other-sessions and require fresh authentication',
      actual: { ok: stale.ok, status: stale.status },
      expected: { ok: false, status: 403 },
    });
  });

  test('a stale session is refused for removing a passkey', async () => {
    const { cookie } = await signUp();
    const { verifyResponse, credential } = await flows.enrollPasskey(cookie, {
      name: 'Old device',
    });
    void credential;
    const sessionBody = (await (await protectedRead(cookie)).json()) as {
      session?: { token: string };
    };
    const token = sessionBody.session?.token ?? '';
    await backdateSession(token, 2);
    const listed = await flows.listPasskeys(cookie);
    const rows = (await listed.json()) as { id: string }[];
    const removed = await flows.deletePasskey(cookie, rows[0]!.id);
    assert({
      given: 'an enrolled passkey and a since-staled session',
      should: 'refuse the removal and require fresh authentication',
      actual: {
        enrolled: verifyResponse.ok,
        removeOk: removed.ok,
        removeStatus: removed.status,
      },
      expected: { enrolled: true, removeOk: false, removeStatus: 403 },
    });
  });
});
