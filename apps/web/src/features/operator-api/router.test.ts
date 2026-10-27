import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { signOperatorRequest } from '@daisy/auth/operator-signature';
import { createAppError } from '@daisy/errors';
import { createOperatorApi, type OperatorApiDependencies } from './router';
import { nodeOperatorCrypto } from './node-crypto';

setupRitewayBun();

const now = 1_793_000_000_000;
const target = 'u'.repeat(24);
const keyOf = (fill: number) => new Uint8Array(32).fill(fill);
const account = {
  userId: target,
  username: 'ada',
  accessState: 'pending' as const,
  accessRevision: 1,
  requestedAt: '2026-10-26T10:00:00.000Z',
  decidedAt: null,
};
const result = {
  commandId: 'c'.repeat(24),
  outcome: 'changed' as const,
  accessState: 'approved' as const,
  accessRevision: 2,
  mail: 'queued' as const,
};

type Calls = { commands: unknown[]; lists: unknown[]; nonces: string[] };

const api = (overrides: Partial<OperatorApiDependencies> = {}) => {
  const calls: Calls = { commands: [], lists: [], nonces: [] };
  const seen = new Set<string>();
  const handle = createOperatorApi({
    audience: 'daisy-web:staging',
    keys: new Map([
      ['k20261026', keyOf(1)],
      ['k20261101', keyOf(2)],
    ]),
    crypto: nodeOperatorCrypto,
    nowMs: () => now,
    admitNonce: async ({ nonce }) => {
      calls.nonces.push(nonce);
      if (seen.has(nonce)) return false;
      seen.add(nonce);
      return true;
    },
    store: {
      listOperatorAccounts: async (input) => {
        calls.lists.push(input);
        return [account, { ...account, userId: 'v'.repeat(24) }];
      },
      runBetaAccessCommand: async (input) => {
        calls.commands.push(input);
        return { kind: 'applied', result };
      },
      readOperatorCommand: async () => ({ result, mailState: 'sent' }),
    },
    nextId: () => 'i'.repeat(24),
    logger: { log: () => {} },
    ...overrides,
  });
  return { handle, calls };
};

let nonceCounter = 0;
const signed = (input: {
  method: 'GET' | 'PUT';
  path: string;
  query?: [string, string][];
  body?: string;
  keyId?: string;
  key?: Uint8Array;
  nonce?: string;
  headers?: Record<string, string>;
}) => {
  const body = new TextEncoder().encode(input.body ?? '');
  const query = input.query ?? [];
  const headers = signOperatorRequest(
    {
      audience: 'daisy-web:staging',
      method: input.method,
      path: input.path,
      query,
      keyId: input.keyId ?? 'k20261026',
      timestamp: String(now),
      nonce:
        input.nonce ?? `nonce${String((nonceCounter += 1)).padStart(17, '0')}`,
      operatorRef: 'o'.repeat(24),
      body,
    },
    input.key ?? keyOf(1),
    nodeOperatorCrypto,
  );
  const search = new URLSearchParams(query).toString();
  return new Request(
    `http://[fdaa::1]:8081${input.path}${search ? `?${search}` : ''}`,
    {
      method: input.method,
      headers: {
        ...headers,
        ...(input.method === 'PUT'
          ? { 'content-type': 'application/json' }
          : {}),
        ...input.headers,
      },
      ...(input.method === 'PUT' ? { body } : {}),
    },
  );
};

const command = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    v: 1,
    commandId: 'c'.repeat(24),
    state: 'approved',
    expectedRevision: 1,
    adminAuditHead: 'a'.repeat(64),
    ...overrides,
  });
const put = (overrides: Parameters<typeof signed>[0] | object = {}) =>
  signed({
    method: 'PUT',
    path: `/operator/v1/accounts/${target}/beta-access`,
    body: command(),
    ...overrides,
  });
const status = async (response: Response) => [
  response.status,
  ((await response.json()) as { error?: { code: string } }).error?.code ?? null,
];

describe('the private operator API (ADR 0079)', () => {
  test('lists one keyset page with a cursor bound to its filter', async () => {
    const { handle, calls } = api();
    const response = await handle(
      signed({
        method: 'GET',
        path: '/operator/v1/accounts',
        query: [
          ['access', 'pending'],
          ['limit', '1'],
        ],
      }),
    );
    const page = (await response.json()) as {
      items: unknown[];
      nextCursor: string;
    };
    const cursor = JSON.parse(
      Buffer.from(page.nextCursor, 'base64url').toString('utf8'),
    );
    assert({
      given: 'a signed list for one pending account with one more behind it',
      should: 'answer one item and a cursor carrying the filter and position',
      actual: {
        status: response.status,
        items: page.items,
        cursor,
        asked: calls.lists,
      },
      expected: {
        status: 200,
        items: [account],
        cursor: {
          v: 1,
          access: 'pending',
          requestedAt: account.requestedAt,
          userId: target,
        },
        asked: [{ access: 'pending', limit: 2, after: null }],
      },
    });
  });

  test('a beta access command reaches the store with its semantic digest', async () => {
    const { handle, calls } = api();
    const first = await handle(put());
    const rotated = await handle(put({ keyId: 'k20261101', key: keyOf(2) }));
    const [one, two] = calls.commands as {
      requestDigest: string;
      operatorRef: string;
      serviceId: string;
      desired: string;
      expectedRevision: number;
      targetUserId: string;
    }[];
    assert({
      given:
        'a signed approval, then the same command retried under the next key',
      should:
        'answer the result and bind both to one digest of the operator and command, not the transport',
      actual: {
        statuses: [first.status, rotated.status],
        body: await first.json(),
        sameDigest: one?.requestDigest === two?.requestDigest,
        bound: [
          one?.serviceId,
          one?.operatorRef,
          one?.targetUserId,
          one?.desired,
          one?.expectedRevision,
        ],
      },
      expected: {
        statuses: [200, 200],
        body: result,
        sameDigest: true,
        bound: ['daisy-admin', 'o'.repeat(24), target, 'approved', 1],
      },
    });
  });

  test('every authentication failure is a uniform 401, before any store work', async () => {
    const { handle, calls } = api();
    const unsigned = new Request(
      `http://[fdaa::1]:8081/operator/v1/accounts?access=pending`,
      {
        headers: {
          'x-forwarded-for': '127.0.0.1',
          'fly-client-ip': '127.0.0.1',
        },
      },
    );
    const results = [
      await status(await handle(unsigned)),
      await status(await handle(put({ key: keyOf(9) }))),
      await status(await handle(put({ keyId: 'unknown1' }))),
      await status(await handle(put({ nonce: 'r'.repeat(22) }))),
      await status(await handle(put({ nonce: 'r'.repeat(22) }))),
    ];
    assert({
      given:
        'no signature with forged forwarding headers, a wrong key, an unknown key, and a replayed nonce',
      should:
        'refuse each as AUTHENTICATION and run the store only for the first use of the nonce',
      actual: { results, commands: calls.commands.length },
      expected: {
        results: [
          [401, 'AUTHENTICATION'],
          [401, 'AUTHENTICATION'],
          [401, 'AUTHENTICATION'],
          [200, null],
          [401, 'AUTHENTICATION'],
        ],
        commands: 1,
      },
    });
  });

  test('a nonce store outage fails closed with 503 and no effect', async () => {
    const { handle, calls } = api({
      admitNonce: async () => {
        throw new Error('redis down');
      },
    });
    assert({
      given: 'a signed command while Redis is down',
      should: 'answer INFRASTRUCTURE and never reach the store',
      actual: [await status(await handle(put())), calls.commands.length],
      expected: [[503, 'INFRASTRUCTURE'], 0],
    });
  });

  test('malformed, oversize, unknown and conflicting requests map to their codes', async () => {
    const conflicting = api({
      store: {
        listOperatorAccounts: async () => [],
        runBetaAccessCommand: async () => {
          throw createAppError('CONFLICT');
        },
        readOperatorCommand: async () => null,
      },
    });
    const { handle } = api();
    const otherFilter = Buffer.from(
      JSON.stringify({
        v: 1,
        access: 'approved',
        requestedAt: account.requestedAt,
        userId: target,
      }),
    ).toString('base64url');
    assert({
      given:
        'a bad command, an oversize body, a missing content type, an unknown route, a cursor for another filter, a stale command and an unknown command id',
      should: 'answer each fixed code without internals',
      actual: [
        await status(
          await handle(put({ body: command({ state: 'pending' }) })),
        ),
        await status(
          await handle(
            new Request(put().url, {
              method: 'PUT',
              headers: put().headers,
              body: 'x'.repeat(16 * 1024 + 1),
            }),
          ),
        ),
        await status(
          await handle(put({ headers: { 'content-type': 'text/plain' } })),
        ),
        await status(
          await handle(new Request('http://[fdaa::1]:8081/operator/v1/admin')),
        ),
        await status(
          await handle(
            signed({
              method: 'GET',
              path: '/operator/v1/accounts',
              query: [
                ['access', 'pending'],
                ['cursor', otherFilter],
              ],
            }),
          ),
        ),
        await status(await conflicting.handle(put())),
        await status(
          await conflicting.handle(
            signed({
              method: 'GET',
              path: `/operator/v1/commands/${'c'.repeat(24)}`,
            }),
          ),
        ),
      ],
      expected: [
        [400, 'VALIDATION'],
        [413, 'PAYLOAD_TOO_LARGE'],
        [400, 'VALIDATION'],
        [404, 'NOT_FOUND'],
        [400, 'VALIDATION'],
        [409, 'CONFLICT'],
        [404, 'NOT_FOUND'],
      ],
    });
  });

  test('a command can be reconciled by its id', async () => {
    const { handle } = api();
    const response = await handle(
      signed({
        method: 'GET',
        path: `/operator/v1/commands/${'c'.repeat(24)}`,
      }),
    );
    assert({
      given: 'a signed read of a stored command',
      should: 'answer its stored result and the approval mail state',
      actual: [response.status, await response.json()],
      expected: [200, { result, mailState: 'sent' }],
    });
  });
});
