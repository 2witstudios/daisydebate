import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  loadSecurityOverview,
  removePasskey,
  renamePasskey,
  requestEmailChange,
  revokeOtherSessions,
  revokeSession,
  type SecurityClient,
} from './security-client';

setupRitewayBun();

const noop = async () => ({ data: null, error: null });

const clientWith = (overrides: Partial<SecurityClient>): SecurityClient => ({
  passkey: {
    listUserPasskeys: async () => ({ data: [], error: null }),
    updatePasskey: noop,
    deletePasskey: noop,
  },
  listSessions: async () => ({ data: [], error: null }),
  revokeSession: noop,
  revokeOtherSessions: noop,
  signOut: noop,
  changeEmail: noop,
  ...overrides,
});

describe('loadSecurityOverview', () => {
  test('a healthy client returns both lists as ok', async () => {
    const passkeys = [{ id: 'p1', name: 'Laptop', createdAt: '2026-01-01' }];
    const sessions = [
      {
        id: 's1',
        token: 't1',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        expiresAt: '2026-01-08',
      },
    ];
    const overview = await loadSecurityOverview(
      clientWith({
        passkey: {
          listUserPasskeys: async () => ({ data: passkeys, error: null }),
          updatePasskey: noop,
          deletePasskey: noop,
        },
        listSessions: async () => ({ data: sessions, error: null }),
      }),
    );
    assert({
      given: 'a client whose lists resolve without error',
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

  test('a stale session on list-sessions reports an empty list, not a crash', async () => {
    const overview = await loadSecurityOverview(
      clientWith({
        listSessions: async () => ({
          data: null,
          error: { status: 403, code: 'SESSION_NOT_FRESH' },
        }),
      }),
    );
    assert({
      given: 'a client whose session list requires fresh authentication',
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
    assert({
      given: 'a client that accepts the revocation',
      should: 'report ok',
      actual: await revokeSession(clientWith({}), 'other-token'),
      expected: { kind: 'ok' },
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
