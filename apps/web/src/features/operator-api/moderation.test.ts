import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authorize } from '@daisy/auth/authorization';
import type { ModerationChange, ModerationStore } from './moderation';
import { api, keyOf, signed, status } from './router.test-support';

setupRitewayBun();

const id = 't'.repeat(24);
const report = {
  reportId: 'r'.repeat(24),
  targetKind: 'round' as const,
  targetId: id,
  reason: 'spam' as const,
  status: 'open' as const,
  reportedAt: '2026-11-02T10:00:00.000Z',
  resolvedAt: null,
};
const fields = {
  v: 1,
  commandId: 'c'.repeat(24),
  adminAuditHead: 'a'.repeat(64),
};

const withStore = (overrides: Partial<ModerationStore> = {}) => {
  const changes: ModerationChange[] = [];
  const digests: string[] = [];
  const { handle } = api({
    moderation: {
      listModerationReports: async () => [
        report,
        { ...report, reportId: 's'.repeat(24) },
      ],
      readModerationReport: async () => ({ report, subject: null }),
      runModerationCommand: async (input) => {
        changes.push(input.change);
        digests.push(input.requestDigest);
        return { v: 1, outcome: 'applied' };
      },
      ...overrides,
    },
  });
  return { handle, changes, digests };
};
const put = (path: string, body: object) =>
  signed({ method: 'PUT', path, body: JSON.stringify({ ...fields, ...body }) });

describe('operator moderation (WATCH-7)', () => {
  test('each command reaches the store as its own named change', async () => {
    const { handle, changes } = withStore();
    const answers = [
      await handle(
        put(`/operator/v1/broadcasts/${id}/stop`, { reason: 'technical' }),
      ),
      await handle(
        put(`/operator/v1/recordings/${id}/takedown`, {
          reason: 'legal_request',
        }),
      ),
      await handle(put(`/operator/v1/chat-messages/${id}/removal`, {})),
      await handle(
        put(`/operator/v1/accounts/${id}/audience-ban`, { state: 'banned' }),
      ),
      await handle(
        put(`/operator/v1/broadcasts/${id}/chat-slow-mode`, { seconds: 30 }),
      ),
      await handle(
        put(`/operator/v1/reports/${id}/resolution`, { outcome: 'upheld' }),
      ),
    ];
    assert({
      given: 'a signed command of each kind',
      should: 'apply each with its target and its closed value',
      actual: [answers.map((answer) => answer.status), changes],
      expected: [
        Array(6).fill(200),
        [
          { action: 'broadcast.stop', broadcastId: id, reason: 'technical' },
          {
            action: 'recording.takedown',
            recordingId: id,
            reason: 'legal_request',
          },
          { action: 'chat_message.remove', messageId: id },
          {
            action: 'account.audience_ban.update',
            userId: id,
            state: 'banned',
          },
          {
            action: 'broadcast.chat_slow_mode.update',
            broadcastId: id,
            seconds: 30,
          },
          { action: 'report.resolve', reportId: id, outcome: 'upheld' },
        ],
      ],
    });
  });

  test('a retry under a new nonce is the same command', async () => {
    const { handle, digests } = withStore();
    const stop = () =>
      put(`/operator/v1/broadcasts/${id}/stop`, { reason: 'technical' });
    await handle(stop());
    await handle(stop());
    assert({
      given: 'the same stop sent twice',
      should: 'give the store one digest to replay against',
      actual: new Set(digests).size,
      expected: 1,
    });
  });

  test('a command it cannot read changes nothing', async () => {
    const { handle, changes } = withStore();
    const response = await handle(
      put(`/operator/v1/broadcasts/${id}/stop`, { reason: 'because' }),
    );
    assert({
      given: 'a reason outside the closed list',
      should: 'refuse and leave the store untouched',
      actual: [response.status, changes],
      expected: [400, []],
    });
  });

  test('an unsigned command never reaches the store', async () => {
    const { handle, changes } = withStore();
    const response = await handle(
      signed({
        method: 'PUT',
        path: `/operator/v1/broadcasts/${id}/stop`,
        body: JSON.stringify({ ...fields, reason: 'technical' }),
        key: keyOf(9),
      }),
    );
    assert({
      given: 'a signature from the wrong key',
      should: 'refuse as any authentication failure and change nothing',
      actual: [response.status, changes],
      expected: [401, []],
    });
  });

  test('the queue pages by keyset with its filter in the cursor', async () => {
    const { handle } = withStore();
    const response = await handle(
      signed({
        method: 'GET',
        path: '/operator/v1/reports',
        query: [
          ['queue', 'review'],
          ['status', 'open'],
          ['limit', '1'],
        ],
      }),
    );
    const page = (await response.json()) as {
      items: unknown[];
      nextCursor: string;
    };
    const stale = await handle(
      signed({
        method: 'GET',
        path: '/operator/v1/reports',
        query: [
          ['queue', 'safety'],
          ['status', 'open'],
          ['cursor', page.nextCursor],
        ],
      }),
    );
    assert({
      given:
        'one report with another behind it, then the cursor on another queue',
      should: 'answer a page, then refuse the mismatched cursor',
      actual: [page.items, stale.status],
      expected: [[report], 400],
    });
  });

  test('a report that is not there answers not found', async () => {
    const { handle } = withStore({ readModerationReport: async () => null });
    const response = await handle(
      signed({ method: 'GET', path: `/operator/v1/reports/${id}` }),
    );
    assert({
      given: 'an unknown report',
      should: 'answer 404',
      actual: await status(response),
      expected: [404, 'NOT_FOUND'],
    });
  });
});

describe('who holds moderation capabilities', () => {
  test('only the operator service does', () => {
    const decide = (principal: Parameters<typeof authorize>[0]['principal']) =>
      authorize({
        principal,
        capability: 'broadcast.stop',
        resource: { kind: 'moderation' },
        context: { account: null },
      }).allow;
    const operator = (
      capabilities: readonly ('broadcast.stop' | 'report.resolve')[],
    ) =>
      ({
        kind: 'operator_service',
        serviceId: 'daisy-admin',
        keyId: 'k1',
        operatorRef: 'o',
        capabilities,
      }) as const;
    assert({
      given: 'the service holding it, the service without it, and anonymous',
      should: 'allow only the first',
      actual: [
        decide(operator(['broadcast.stop'])),
        decide(operator(['report.resolve'])),
        decide({ kind: 'anonymous' }),
      ],
      expected: [true, false, false],
    });
  });
});
