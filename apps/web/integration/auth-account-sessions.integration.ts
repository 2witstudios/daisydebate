import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAccountFlows } from './auth-account-helpers';
import { origin } from './auth-mounted-helpers';

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();

const { signUp } = await createAccountFlows();
const sessionsRoute = await import('../src/app/api/account/sessions/route');
const revokeRoute = await import(
  '../src/app/api/account/sessions/revoke/route'
);

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

describe('AC7 GET /api/account/sessions never exposes a session token', () => {
  test('a real session listing carries no token key at any depth', async () => {
    const { cookie } = await signUp();
    const response = await listSessions(cookie);
    const body = await response.text();
    const parsed = JSON.parse(body) as {
      sessions: Array<Record<string, unknown>>;
    };
    assert({
      given: "a real signed-in account's own session listing",
      should:
        'answer 200 with exactly one current session and no token field anywhere in the body',
      actual: {
        status: response.status,
        hasTokenKey: parsed.sessions.some((row) => 'token' in row),
        rawBodyMentionsToken: /"token"\s*:/.test(body),
        currentCount: parsed.sessions.filter((row) => row.current === true)
          .length,
      },
      expected: {
        status: 200,
        hasTokenKey: false,
        rawBodyMentionsToken: false,
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
