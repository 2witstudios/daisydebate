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
        ipAddress: null,
        current: true,
      },
    ];
    const overview = await withFetch(
      () => jsonResponse({ sessions }),
      () =>
        loadSecurityOverview(
          clientWith({
            passkey: {
              listUserPasskeys: async () => ({ data: passkeys, error: null }),
              updatePasskey: noop,
              deletePasskey: noop,
            },
          }),
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
        ipAddress: null,
        current: true,
      },
    ];
    const overview = await withFetch(
      () => jsonResponse({ sessions }),
      () =>
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
      () => loadSecurityOverview(clientWith({})),
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
      () => revokeSession('other-session-id'),
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
      () => revokeSession('foreign-session-id'),
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
  test('a conflicting email reports conflict', async () => {
    assert({
      given: 'a client rejecting the new address as already in use',
      should: 'report conflict',
      actual: await requestEmailChange(
        clientWith({
          changeEmail: async () => ({ data: null, error: { status: 409 } }),
        }),
        'taken@example.test',
      ),
      expected: { kind: 'conflict' },
    });
  });

  test('a rate-limited attempt reports rate-limited', async () => {
    assert({
      given: 'a client throttling repeated attempts',
      should: 'report rate-limited',
      actual: await requestEmailChange(
        clientWith({
          changeEmail: async () => ({ data: null, error: { status: 429 } }),
        }),
        'someone@example.test',
      ),
      expected: { kind: 'rate-limited' },
    });
  });

  test('success reports ok', async () => {
    assert({
      given: 'a client that accepts the request',
      should: 'report ok',
      actual: await requestEmailChange(clientWith({}), 'new@example.test'),
      expected: { kind: 'ok' },
    });
  });
});
