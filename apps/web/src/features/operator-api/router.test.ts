import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import {
  account,
  api,
  command,
  keyOf,
  put,
  result,
  signed,
  status,
  target,
} from './router.test-support';

setupRitewayBun();

/** A store refusing everything a test does not name. */
const storeOf = () => ({
  listOperatorAccounts: async () => [],
  runBetaAccessCommand: async () => {
    throw createAppError('CONFLICT');
  },
  readOperatorCommand: async () => null,
  listOperatorReports: async () => [],
  listOperatorRestrictions: async () => [],
  resolveReport: async () => {
    throw createAppError('CONFLICT');
  },
  liftModeration: async () => {
    throw createAppError('CONFLICT');
  },
});

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
        listOperatorReports: async () => [],
        listOperatorRestrictions: async () => [],
        resolveReport: async () => {
          throw new Error('Unexpected report command');
        },
        liftModeration: async () => {
          throw new Error('Unexpected lift');
        },
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
      should: 'answer its action, stored result and the approval mail state',
      actual: [response.status, await response.json()],
      expected: [
        200,
        { action: 'account.beta_access.update', result, mailState: 'sent' },
      ],
    });
  });
});

test('an unexpected handler failure reaches the error reporter; a refusal does not (ISSUE-681)', async () => {
  const captured: unknown[] = [];
  const reporter = {
    capture: (error: unknown, context: unknown) => {
      captured.push([(error as Error).message, context]);
    },
  };
  const broken = api({
    reporter,
    store: {
      listOperatorReports: async () => [],
      listOperatorRestrictions: async () => [],
      resolveReport: async () => {
        throw new Error('Unexpected report command');
      },
      liftModeration: async () => {
        throw new Error('Unexpected lift');
      },
      listOperatorAccounts: async () => {
        throw new Error('pool exhausted');
      },
      runBetaAccessCommand: async () => {
        throw createAppError('CONFLICT');
      },
      readOperatorCommand: async () => null,
    },
  });
  const list = signed({
    method: 'GET',
    path: '/operator/v1/accounts',
    query: [['access', 'pending']],
  });
  const results = [
    await status(await broken.handle(list)),
    await status(await broken.handle(put())),
  ];
  assert({
    given:
      'a listing whose store throws a plain error, and a command refused as CONFLICT',
    should:
      'answer INTERNAL and report only the unexpected error, with a fixed code and the route',
    actual: { results, captured },
    expected: {
      results: [
        [500, 'INTERNAL'],
        [409, 'CONFLICT'],
      ],
      captured: [
        [
          'pool exhausted',
          {
            requestId: 'i'.repeat(24),
            route: 'operator.listAccounts',
            errorCode: 'INTERNAL',
          },
        ],
      ],
    },
  });
});

describe('the report routes (ADR 0098)', () => {
  const report = {
    id: 'r'.repeat(24),
    reporter: 'ada',
    subject: 'bea',
    subjectUserId: target,
    reason: 'hate' as const,
    surface: 'online' as const,
    createdAt: '2026-11-02T00:00:00.000Z',
    reportsOnSubject: 2,
  };
  const head = 'a'.repeat(64);
  test('lists the queue, with a cursor when there is more', async () => {
    const { handle } = api({
      store: {
        ...storeOf(),
        listOperatorReports: async () => [
          report,
          { ...report, id: 's'.repeat(24) },
        ],
      },
    });
    const response = await handle(
      signed({
        method: 'GET',
        path: '/operator/v1/reports',
        query: [['limit', '1']],
      }),
    );
    const page = (await response.json()) as {
      items: unknown[];
      nextCursor: string | null;
    };
    assert({
      given: 'more reports than the limit',
      should: 'answer one and where the next page starts',
      actual: [response.status, page.items, typeof page.nextCursor],
      expected: [200, [report], 'string'],
    });
  });
  test('a decision carries its length, retention and digest', async () => {
    const seen: Record<string, unknown>[] = [];
    const { handle } = api({
      store: {
        ...storeOf(),
        resolveReport: async (input) => {
          seen.push(input as unknown as Record<string, unknown>);
          return {
            commandId: input.commandId,
            reportId: input.reportId,
            outcome: input.outcome,
          };
        },
      },
    });
    const response = await handle(
      signed({
        method: 'PUT',
        path: `/operator/v1/reports/${report.id}/resolution`,
        body: JSON.stringify({
          v: 1,
          commandId: 'c'.repeat(24),
          outcome: 'suspended',
          suspendDays: 7,
          adminAuditHead: head,
        }),
      }),
    );
    const input = seen[0]!;
    const now = Date.parse(String(input['now']));
    assert({
      given: 'a seven-day suspension',
      should: 'end it in a week and keep evidence for the proposed year',
      actual: [
        response.status,
        input['operatorRef'],
        Date.parse(String(input['suspendUntil'])) - now,
        Date.parse(String(input['purgeAfter'])) - now,
        /^[0-9a-f]{64}$/.test(String(input['requestDigest'])),
      ],
      expected: [200, 'o'.repeat(24), 7 * 86_400_000, 365 * 86_400_000, true],
    });
  });
  test('a suspension needs a length, and nothing else has one', async () => {
    const { handle } = api();
    const put = (outcome: string, suspendDays: number | null) =>
      handle(
        signed({
          method: 'PUT',
          path: `/operator/v1/reports/${report.id}/resolution`,
          body: JSON.stringify({
            v: 1,
            commandId: 'c'.repeat(24),
            outcome,
            suspendDays,
            adminAuditHead: head,
          }),
        }),
      );
    assert({
      given: 'a suspension with no days, and a dismissal with days',
      should: 'refuse both',
      actual: [
        (await put('suspended', null)).status,
        (await put('dismissed', 3)).status,
      ],
      expected: [400, 400],
    });
  });
  test('lifting reaches the store by the action it names', async () => {
    const lifted: string[] = [];
    const { handle } = api({
      store: {
        ...storeOf(),
        liftModeration: async (input) => {
          lifted.push(input.actionId);
          return { commandId: input.commandId, actionId: input.actionId };
        },
      },
    });
    const response = await handle(
      signed({
        method: 'PUT',
        path: `/operator/v1/moderation/${report.id}/lift`,
        body: JSON.stringify({
          v: 1,
          commandId: 'c'.repeat(24),
          adminAuditHead: head,
        }),
      }),
    );
    assert({
      given: 'a signed lift',
      should: 'lift that action',
      actual: [response.status, lifted],
      expected: [200, [report.id]],
    });
  });
});
