import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { APIRequestContext } from '@playwright/test';
import { signUpMember } from '../e2e/support/accounts';
import {
  captureRoomSignIn,
  parseRoomCleanupEvidence,
  roomCleanupTables,
} from '../e2e/support/room-accounts';
import {
  admitRoomCleanupConnection,
  dispatchRoomCleanupRequest,
} from '../e2e/support/room-account-cleanup';

setupRitewayBun();

const url = 'postgres://daisy_e2e:private@localhost:15432/daisy_wt_unit_e2e';
const result = {
  version: 1,
  admitted: true,
  target: {
    database: 'daisy_wt_unit_e2e',
    role: 'daisy_e2e',
    hostname: 'localhost',
    port: '15432',
  },
};

/** Only the forwarding transport is scripted; the existing signup helper runs. */
function requestProbe(failAt?: string) {
  const captured: string[] = [];
  const forwarded: string[] = [];
  const bound: boolean[] = [];
  const captureBeforeDispatch: boolean[] = [];
  const request = {
    async post(path: string, options?: { data?: { email?: string } }) {
      bound.push(this === request);
      forwarded.push(new URL(path, 'https://unit.example').pathname);
      if (path === '/api/auth/sign-in/magic-link')
        captureBeforeDispatch.push(captured[0] === options?.data?.email);
      if (path === failAt) throw new Error('injected transport failure');
      const status =
        path === '/auth/confirm'
          ? 303
          : path === '/api/account/username'
            ? 201
            : 200;
      return { status: () => status };
    },
    async get() {
      bound.push(this === request);
      return {
        json: async () => [
          { text: 'https://unit.example/auth/confirm?token=unit-placeholder' },
        ],
      };
    },
  };
  return {
    request: request as unknown as APIRequestContext,
    captured,
    forwarded,
    bound,
    captureBeforeDispatch,
  };
}

describe('ROOM-6.1 signup forwarding', () => {
  for (const failAt of [
    undefined,
    '/api/auth/sign-in/magic-link',
    '/api/account/username',
  ]) {
    test(`captures the existing helper's email before ${failAt ?? 'success'}`, async () => {
      const probe = requestProbe(failAt);
      const originalPost = probe.request.post;
      const wrapped = captureRoomSignIn(probe.request, 'https://unit.example', {
        rememberEmail: (email) => probe.captured.push(email),
      });
      let failed = false;
      try {
        await signUpMember(wrapped);
      } catch (error) {
        failed =
          error instanceof Error &&
          error.message === 'injected transport failure';
      }
      assert({
        given: `the actual signUpMember helper, failure at ${failAt ?? 'none'}`,
        should:
          'capture before dispatch, bind methods and leave the original untouched',
        actual: {
          failed,
          captures: probe.captured.length,
          beforeDispatch: probe.captureBeforeDispatch,
          bound: probe.bound.every(Boolean),
          unchanged: probe.request.post === originalPost,
        },
        expected: {
          failed: failAt !== undefined,
          captures: 1,
          beforeDispatch: [true],
          bound: true,
          unchanged: true,
        },
      });
    });
  }

  test('does not capture other paths, origins or data fields', async () => {
    const probe = requestProbe();
    const wrapped = captureRoomSignIn(probe.request, 'https://unit.example', {
      rememberEmail: (email) => probe.captured.push(email),
    });
    for (const path of [
      '/api/account/username',
      'https://other.example/api/auth/sign-in/magic-link',
      '/api/auth/sign-in/magic-link-extra',
    ])
      await wrapped.post(path, {
        data: { email: 'e2eabcdefghijklmnop@example.test' },
      });
    assert({
      given: 'other paths and origins with an email field',
      should: 'forward unchanged without adding them to cleanup ownership',
      actual: [
        probe.captured.length,
        probe.forwarded.length,
        probe.bound.every(Boolean),
      ],
      expected: [0, 3, true],
    });
  });
});

describe('ROOM-6.1 admission process contract', () => {
  for (const [label, output] of [
    ['corrupt JSON', '{'],
    ['wrong version', JSON.stringify({ ...result, version: 2 })],
    [
      'denial',
      JSON.stringify({ version: 1, admitted: false, reason: 'target' }),
    ],
    [
      'wrong database',
      JSON.stringify({
        ...result,
        target: { ...result.target, database: 'daisy_test' },
      }),
    ],
    [
      'wrong role',
      JSON.stringify({
        ...result,
        target: { ...result.target, role: 'owner' },
      }),
    ],
    [
      'wrong server',
      JSON.stringify({
        ...result,
        target: { ...result.target, port: '25432' },
      }),
    ],
    [
      'extra field',
      JSON.stringify({ ...result, credential: 'unit-placeholder' }),
    ],
    ['process failure', undefined],
  ] as const) {
    test(`refuses ${label} before opening SQL`, async () => {
      let connections = 0;
      let refused = false;
      try {
        await admitRoomCleanupConnection(
          { E2E_DATABASE_URL: url },
          async () => {
            if (output === undefined)
              throw new Error('private process diagnostic');
            return output;
          },
          () => {
            connections += 1;
          },
        );
      } catch (error) {
        refused =
          error instanceof Error &&
          error.message === 'Room account cleanup admission refused';
      }
      assert({
        given: label,
        should: 'refuse without connection or raw diagnostics',
        actual: { refused, connections },
        expected: { refused: true, connections: 0 },
      });
    });
  }
  test('rechecks admission on every connection attempt', async () => {
    let admissions = 0;
    const connect = async (databaseURL: string) => databaseURL === url;
    const request = async () => {
      admissions += 1;
      return JSON.stringify(result);
    };
    const actual = await Promise.all(
      [1, 2].map(() =>
        admitRoomCleanupConnection({ E2E_DATABASE_URL: url }, request, connect),
      ),
    );
    assert({
      given: 'two cleanup attempts',
      should: 'admit each exact URL independently',
      actual: { admitted: actual, admissions },
      expected: { admitted: [true, true], admissions: 2 },
    });
  });
});

test('compares default PostgreSQL port and snapshots the admitted URL', async () => {
  const original = 'postgres://daisy_e2e:private@localhost/daisy_wt_unit_e2e';
  const env = { E2E_DATABASE_URL: original };
  let connected = '';
  await admitRoomCleanupConnection(
    env,
    async (snapshot) => {
      env.E2E_DATABASE_URL = 'postgres://owner:private@remote.example/daisy';
      assert({
        given: 'caller environment changed during admission',
        should: 'keep the per-attempt snapshot private and stable',
        actual: snapshot.E2E_DATABASE_URL === original,
        expected: true,
      });
      return JSON.stringify({
        version: 1,
        admitted: true,
        target: {
          database: 'daisy_wt_unit_e2e',
          role: 'daisy_e2e',
          hostname: 'localhost',
          port: '5432',
        },
      });
    },
    (url) => {
      connected = url;
    },
  );
  assert({
    given: 'default port admitted for a snapshot',
    should: 'connect only to the exact admitted URL',
    actual: connected,
    expected: original,
  });
});

describe('ROOM-6.1 cleanup evidence boundary', () => {
  const counts = Object.fromEntries(roomCleanupTables.map((key) => [key, 0]));
  test('accepts complete count-only worker evidence', () => {
    const evidence = { before: counts, after: counts };
    assert({
      given: 'all exact owned table counts',
      should: 'preserve the evidence',
      actual: parseRoomCleanupEvidence(JSON.stringify(evidence)),
      expected: evidence,
    });
  });
  for (const [label, value] of [
    [
      'wrong table names',
      { before: counts, after: { ...counts, users: undefined, unrelated: 0 } },
    ],
    ['array counts', { before: counts, after: Array(13).fill(0) }],
    ['extra table', { before: counts, after: { ...counts, unrelated: 0 } }],
    ['negative count', { before: counts, after: { ...counts, users: -1 } }],
    ['fractional count', { before: counts, after: { ...counts, users: 0.5 } }],
    ['text count', { before: counts, after: { ...counts, users: '0' } }],
    [
      'unsafe count',
      {
        before: counts,
        after: { ...counts, users: Number.MAX_SAFE_INTEGER + 1 },
      },
    ],
    [
      'unexpected output field',
      { before: counts, after: counts, extra: 'unexpected' },
    ],
  ] as const) {
    test(`refuses ${label}`, () => {
      let refused = false;
      try {
        parseRoomCleanupEvidence(JSON.stringify(value));
      } catch {
        refused = true;
      }
      assert({
        given: label,
        should: 'refuse instead of reporting complete cleanup',
        actual: refused,
        expected: true,
      });
    });
  }
});

describe('ROOM-6.1a cleanup request boundary', () => {
  const account = {
    email: 'e2eabcdefghijklmnop@example.test',
    mailExpected: false,
    uncertain: false,
  };
  const request = { action: 'clean', accounts: [account] };
  for (const [label, value] of [
    ['array action', { ...request, action: ['clean'] }],
    ['numeric action', { ...request, action: 1 }],
    ['null action', { ...request, action: null }],
    ['unknown action', { ...request, action: 'erase' }],
    [
      'unknown envelope key',
      { ...request, target: 'unit-private-placeholder' },
    ],
    [
      'unknown ownership key',
      {
        ...request,
        accounts: [{ ...account, actorId: 'unit-private-placeholder' }],
      },
    ],
  ] as const) {
    test(`refuses ${label} before invocation, admission and connection`, async () => {
      const calls = { invocation: 0, admission: 0, connection: 0 };
      let message: string | undefined;
      try {
        await dispatchRoomCleanupRequest(value, async () => {
          calls.invocation++;
          await admitRoomCleanupConnection(
            { E2E_DATABASE_URL: url },
            async () => {
              calls.admission++;
              return JSON.stringify(result);
            },
            () => {
              calls.connection++;
            },
          );
          return { before: {}, after: {} };
        });
      } catch (error) {
        message = error instanceof Error ? error.message : undefined;
      }
      assert({
        given: label,
        should:
          'return a sanitized input refusal with no cleanup invocation, admission or SQL connection',
        actual: { calls, message },
        expected: {
          calls: { invocation: 0, admission: 0, connection: 0 },
          message: 'Room account cleanup input refused',
        },
      });
    });
  }
  for (const action of ['inspect', 'clean'] as const) {
    test(`preserves valid ${action} ownership and partial identity`, async () => {
      let invoked: unknown;
      let calls = 0;
      const accounts = [
        account,
        {
          ...account,
          email: 'e2eponmlkjihgfedcba@example.test',
          userId: 'abcdefghijklmnopqrstuvwx',
          mailExpected: true,
        },
      ];
      const evidence = {
        before: { users: 2 },
        after: { users: action === 'clean' ? 0 : 2 },
      };
      const result = await dispatchRoomCleanupRequest(
        { action, accounts },
        async (input) => {
          calls++;
          invoked = input;
          return evidence;
        },
      );
      assert({
        given: `valid ${action} with known and partial signup identities`,
        should:
          'invoke once with exact action and ownership and preserve supplied evidence',
        actual: { calls, invoked, result },
        expected: {
          calls: 1,
          invoked: {
            action,
            accounts: accounts.map((item) => ({
              ...item,
              userId: 'userId' in item ? item.userId : undefined,
            })),
          },
          result: evidence,
        },
      });
    });
  }
});
