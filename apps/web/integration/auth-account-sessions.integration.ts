import { afterAll } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAccountFlows } from './auth-account-helpers';
import { requireTestServices } from '@daisy/config';
import { userIdOf, withSql } from './fixtures';
import { trackRevocations } from './auth-outbox-helpers';

requireTestServices(process.env);
setupRitewayBun();

const { signUp, flows } = createAccountFlows();
const { origin, routes, withLoggedEvents } = flows.testApp;
const { signInAgain } = flows;
const sessionsRoute = routes.sessions;
const revokeRoute = routes.revokeSession;

const listSessions = (cookie: string) =>
  sessionsRoute.GET(
    new Request(`${origin}/api/account/sessions`, { headers: { cookie } }),
  );

const revokeSession = (cookie: string, id: string) =>
  revokeRoute.POST(
    new Request(`${origin}/api/account/sessions/revoke`, {
      method: 'POST',
      headers: {
        cookie,
        origin,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id }),
    }),
  );

describe('AC7 GET /api/account/sessions never exposes a session token or client IP', () => {
  test('a real session listing carries no token or IP address key', async () => {
    const { cookie } = await signUp();
    const response = await listSessions(cookie);
    const body = await response.text();
    const parsed = JSON.parse(body) as {
      sessions: Array<Record<string, unknown>>;
    };
    assert({
      given: "a real signed-in account's own session listing",
      should:
        'answer 200 with exactly one current session and no token or ipAddress field anywhere in the body',
      actual: {
        status: response.status,
        hasTokenKey: parsed.sessions.some((row) => 'token' in row),
        rawBodyMentionsToken: /"token"\s*:/.test(body),
        hasIpAddressKey: /"ipAddress"\s*:/.test(body),
        currentCount: parsed.sessions.filter((row) => row.current === true)
          .length,
      },
      expected: {
        status: 200,
        hasTokenKey: false,
        rawBodyMentionsToken: false,
        hasIpAddressKey: false,
        currentCount: 1,
      },
    });
  });

  test('revoking by session id ends that session without a client-visible token', async () => {
    const account = await signUp();
    const before = (
      (await (await listSessions(account.cookie)).json()) as {
        sessions: Array<{ id: string }>;
      }
    ).sessions;
    const ownId = before[0]?.id ?? '';
    const response = await revokeSession(account.cookie, ownId);
    // A fresh sign-up has exactly one live session, so revoking "by id" here
    // revokes the caller's own current session — the same cookie is then no
    // longer a valid session, proving the revoke reached the real row (not
    // a no-op), never by inspecting a token this call never returned.
    const after = await listSessions(account.cookie);
    assert({
      given: "the only session id from the caller's own listing",
      should:
        'revoke it, answer ok, and leave the now-revoked cookie unauthenticated',
      actual: {
        revokeStatus: response.status,
        revokeBody: await response.json(),
        afterStatus: after.status,
      },
      expected: {
        revokeStatus: 200,
        revokeBody: { status: true },
        afterStatus: 401,
      },
    });
  });

  test('another account cannot revoke by guessing a foreign session id', async () => {
    const victim = await signUp();
    const attacker = await signUp();
    const victimSessions = (
      (await (await listSessions(victim.cookie)).json()) as {
        sessions: Array<{ id: string }>;
      }
    ).sessions;
    const victimSessionId = victimSessions[0]?.id ?? '';
    const response = await revokeSession(attacker.cookie, victimSessionId);
    const stillListed = (
      (await (await listSessions(victim.cookie)).json()) as {
        sessions: Array<{ id: string }>;
      }
    ).sessions.some((row) => row.id === victimSessionId);
    assert({
      given: "an attacker POSTing the victim's real session id",
      should: 'refuse with 404 and leave the victim session untouched',
      actual: { status: response.status, stillListed },
      expected: { status: 404, stillListed: true },
    });
  });
});

describe('ISSUE-49 POST /api/account/sessions/revoke is audited', () => {
  const cleanups: Array<() => Promise<unknown>> = [];
  afterAll(async () => {
    for (const cleanup of cleanups) await cleanup();
  });

  test('a successful revoke logs auth.session.revoked and rings the doorbell', async () => {
    const account = await signUp();
    const revocations = await trackRevocations(
      (await userIdOf(account.email)) ?? '',
    );
    cleanups.push(revocations.cleanup);
    const ownId =
      (
        (await (await listSessions(account.cookie)).json()) as {
          sessions: Array<{ id: string }>;
        }
      ).sessions[0]?.id ?? '';
    const { result, events } = await withLoggedEvents(() =>
      revokeSession(account.cookie, ownId),
    );
    assert({
      given:
        "a real account revoking its own session from the account UI's route",
      should:
        'answer ok, log auth.session.revoked once and append one session.revoked outbox row',
      actual: {
        status: result.status,
        revokedEvents: events.filter(
          (event) => event === 'auth.session.revoked',
        ).length,
        doorbells: await revocations.appended(),
      },
      expected: { status: 200, revokedEvents: 1, doorbells: 1 },
    });
  });

  test('a refused revoke logs no revocation', async () => {
    const victim = await signUp();
    const attacker = await signUp();
    const victimId =
      (
        (await (await listSessions(victim.cookie)).json()) as {
          sessions: Array<{ id: string }>;
        }
      ).sessions[0]?.id ?? '';
    const { result, events } = await withLoggedEvents(() =>
      revokeSession(attacker.cookie, victimId),
    );
    assert({
      given: 'a revoke of a foreign session id, refused as not found',
      should: 'log no auth.session.revoked event',
      actual: {
        status: result.status,
        revoked: events.includes('auth.session.revoked'),
      },
      expected: { status: 404, revoked: false },
    });
  });
});

type Listed = { sessions: Array<{ id: string; current: boolean }> };

/** An account signed in twice: the caller's cookie and a second session's. */
const twoSessions = async () => {
  const account = await signUp();
  const other = await signInAgain(account.email);
  const listed = (await (await listSessions(account.cookie)).json()) as Listed;
  const otherId = listed.sessions.find((row) => !row.current)?.id ?? '';
  return { cookie: account.cookie, other, otherId };
};

/** Whether a cookie still authenticates on its next real request. */
const stillSignedIn = async (cookie: string) =>
  (await listSessions(cookie)).status === 200;

describe('POST /api/account/sessions/revoke from another session', () => {
  test("revoking another session's row refuses that session's cookie on its next request (ISSUE-174)", async () => {
    const { cookie, other, otherId } = await twoSessions();
    const response = await revokeSession(cookie, otherId);
    assert({
      given: "a second session revoked by id from the first session's row",
      should:
        "answer ok, refuse the revoked session's cookie on its next request and keep the caller signed in",
      actual: {
        status: response.status,
        revokedStillSignedIn: await stillSignedIn(other),
        callerStillSignedIn: await stillSignedIn(cookie),
      },
      expected: {
        status: 200,
        revokedStillSignedIn: false,
        callerStillSignedIn: true,
      },
    });
  });

  test('a stale session is refused and the targeted session survives (ISSUE-167)', async () => {
    const { cookie, other, otherId } = await twoSessions();
    const token =
      (
        await flows.app.auth().instance.api.getSession({
          headers: new Headers({ cookie }),
          query: { disableRefresh: true },
        })
      )?.session.token ?? '';
    await withSql(
      (sql) =>
        sql`UPDATE session SET created_at = now() - interval '2 hours' WHERE token = ${token}`,
    );
    const response = await revokeSession(cookie, otherId);
    assert({
      given:
        "a caller whose session was created outside the fresh window revoking another session's row",
      should:
        'refuse with 401 (fresh authentication required) and leave the targeted session signed in',
      actual: {
        status: response.status,
        targetStillSignedIn: await stillSignedIn(other),
      },
      expected: { status: 401, targetStillSignedIn: true },
    });
  });
});
