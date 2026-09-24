import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  loadSecurityOverview,
  removePasskey,
  renamePasskey,
  requestEmailChange,
  revokeOtherSessions,
  revokeSession,
} from './security-client';
import {
  clientWith,
  jsonResponse,
  noop,
  withFetch,
} from './security-client.test-support';

setupRitewayBun();

describe('loadSecurityOverview', () => {
  test('a healthy client and route return both lists as ok', async () => {
    const passkeys = [{ id: 'p1', name: 'Laptop', createdAt: '2026-01-01' }];
    const sessions = [
      {
        id: 's1',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        expiresAt: '2026-01-08',
        userAgent: null,
        current: true,
      },
    ];
    const overview = await withFetch(
      () => jsonResponse({ sessions }),
      (send) =>
        loadSecurityOverview(
          clientWith({
            passkey: {
              listUserPasskeys: async () => ({ data: passkeys, error: null }),
              updatePasskey: noop,
              deletePasskey: noop,
            },
          }),
          send,
        ),
    );
    assert({
      given: 'a client and route that both resolve without error',
      should: 'return both lists and an ok outcome for each',
      actual: {
        passkeys: overview.passkeys,
        sessions: overview.sessions,
        passkeysOutcome: overview.passkeysOutcome,
        sessionsOutcome: overview.sessionsOutcome,
      },
      expected: {
        passkeys,
        sessions,
        passkeysOutcome: { kind: 'ok' },
        sessionsOutcome: { kind: 'ok' },
      },
    });
  });

  test('a throwing passkey list does not fail the session list, or the whole call', async () => {
    const sessions = [
      {
        id: 's1',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        expiresAt: '2026-01-08',
        userAgent: null,
        current: true,
      },
    ];
    const overview = await withFetch(
      () => jsonResponse({ sessions }),
      (send) =>
        loadSecurityOverview(
          clientWith({
            passkey: {
              listUserPasskeys: () => {
                throw new Error('network down');
              },
              updatePasskey: noop,
              deletePasskey: noop,
            },
          }),
          send,
        ),
    );
    assert({
      given: 'a passkey list call that throws while the session route succeeds',
      should:
        'report the sessions normally and an unavailable passkey outcome, never reject',
      actual: {
        sessions: overview.sessions,
        passkeys: overview.passkeys,
        passkeysOutcome: overview.passkeysOutcome,
        sessionsOutcome: overview.sessionsOutcome,
      },
      expected: {
        sessions,
        passkeys: [],
        passkeysOutcome: { kind: 'unavailable' },
        sessionsOutcome: { kind: 'ok' },
      },
    });
  });

  test('a stale session on the sessions route reports an empty list, not a crash', async () => {
    const overview = await withFetch(
      () =>
        jsonResponse(
          { error: { code: 'AUTHENTICATION', message: 'x', requestId: 'r' } },
          401,
        ),
      (send) => loadSecurityOverview(clientWith({}), send),
    );
    assert({
      given: 'a session route that requires fresh authentication',
      should: 'report an empty session list and a stale-session outcome',
      actual: {
        sessions: overview.sessions,
        outcome: overview.sessionsOutcome,
      },
      expected: { sessions: [], outcome: { kind: 'stale-session' } },
    });
  });
});

describe('renamePasskey', () => {
  test('success reports ok', async () => {
    assert({
      given: 'a client that accepts the rename',
      should: 'report ok',
      actual: await renamePasskey(clientWith({}), 'p1', 'Roaming key'),
      expected: { kind: 'ok' },
    });
  });

  test("another user's credential id reports not-found, never a crash", async () => {
    assert({
      given: "a client rejecting another user's passkey id",
      should: 'report not-found',
      actual: await renamePasskey(
        clientWith({
          passkey: {
            listUserPasskeys: async () => ({ data: [], error: null }),
            updatePasskey: async () => ({
              data: null,
              error: { status: 404 },
            }),
            deletePasskey: noop,
          },
        }),
        'foreign-id',
        'Renamed',
      ),
      expected: { kind: 'not-found' },
    });
  });

  test('a throwing client is unavailable, never an uncaught rejection', async () => {
    assert({
      given: 'a client whose call throws before resolving',
      should: 'report unavailable',
      actual: await renamePasskey(
        clientWith({
          passkey: {
            listUserPasskeys: async () => ({ data: [], error: null }),
            updatePasskey: () => {
              throw new Error('network down');
            },
            deletePasskey: noop,
          },
        }),
        'p1',
        'Renamed',
      ),
      expected: { kind: 'unavailable' },
    });
  });
});

describe('removePasskey', () => {
  test('a stale session refuses removal', async () => {
    assert({
      given: 'a client requiring fresh authentication to remove a credential',
      should: 'report stale-session',
      actual: await removePasskey(
        clientWith({
          passkey: {
            listUserPasskeys: async () => ({ data: [], error: null }),
            updatePasskey: noop,
            deletePasskey: async () => ({
              data: null,
              error: { status: 403, code: 'SESSION_NOT_FRESH' },
            }),
          },
        }),
        'p1',
      ),
      expected: { kind: 'stale-session' },
    });
  });
});

describe('revokeSession and revokeOtherSessions', () => {
  test('revoking another session succeeds', async () => {
    const actual = await withFetch(
      () => jsonResponse({ status: true }),
      (send) => revokeSession('other-session-id', send),
    );
    assert({
      given: 'a route that accepts the revocation',
      should: 'report ok',
      actual,
      expected: { kind: 'ok' },
    });
  });

  test("another user's session id reports not-found, never a crash", async () => {
    const actual = await withFetch(
      () =>
        jsonResponse(
          { error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' } },
          404,
        ),
      (send) => revokeSession('foreign-session-id', send),
    );
    assert({
      given: "a route refusing another user's session id",
      should: 'report not-found',
      actual,
      expected: { kind: 'not-found' },
    });
  });

  test('a stale session refuses revoking all others', async () => {
    assert({
      given: 'a client requiring fresh authentication to revoke other sessions',
      should: 'report stale-session',
      actual: await revokeOtherSessions(
        clientWith({
          revokeOtherSessions: async () => ({
            data: null,
            error: { status: 403, code: 'SESSION_NOT_FRESH' },
          }),
        }),
      ),
      expected: { kind: 'stale-session' },
    });
  });
});

describe('requestEmailChange', () => {
  const answering = (response: Response | Error) => {
    const requests: { url: string; init: RequestInit }[] = [];
    const send = async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (response instanceof Error) throw response;
      return response;
    };
    return { requests, send };
  };

  test('starts the change over the Better Auth route', async () => {
    const { requests, send } = answering(jsonResponse({ status: true }));
    const outcome = await requestEmailChange('new@example.test', send);
    assert({
      given: 'an accepted change',
      should:
        'report ok, having posted the new address and the page to return to',
      actual: {
        outcome,
        url: requests[0]?.url,
        method: requests[0]?.init.method,
        headers: requests[0]?.init.headers,
        body: JSON.parse(String(requests[0]?.init.body)) as unknown,
      },
      expected: {
        outcome: { kind: 'ok' },
        url: '/api/auth/change-email',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: {
          newEmail: 'new@example.test',
          callbackURL: '/settings/security',
        },
      },
    });
  });

  test('maps refusals from the Better Auth error body', async () => {
    const outcome = async (response: Response | Error) =>
      (await requestEmailChange('x@example.test', answering(response).send))
        .kind;
    assert({
      given:
        'a stale session, a taken address, throttling, bad input, an unreadable body and no answer',
      should:
        'answer stale-session, conflict, rate-limited, invalid, unavailable, unavailable',
      actual: [
        await outcome(
          jsonResponse({ code: 'SESSION_NOT_FRESH', message: 'stale' }, 403),
        ),
        await outcome(jsonResponse({ code: 'EMAIL_TAKEN' }, 409)),
        await outcome(new Response(null, { status: 429 })),
        await outcome(jsonResponse({ code: 'INVALID_EMAIL' }, 400)),
        await outcome(new Response('<html>', { status: 502 })),
        await outcome(new Error('network down')),
      ],
      expected: [
        'stale-session',
        'conflict',
        'rate-limited',
        'invalid',
        'unavailable',
        'unavailable',
      ],
    });
  });
});
