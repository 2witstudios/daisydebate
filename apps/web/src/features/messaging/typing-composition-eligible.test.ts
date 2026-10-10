import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type { Database } from '@daisy/db';
import { composeMessagingTyping } from './typing-operations';
import { typingWorld } from './typing.test-support';
setupRitewayBun();
test('typing factory threads one fenced transaction through canonical facts and rereads trusted time after producer awaits', async () => {
  const f = typingWorld(),
    self = f.accounts[0]!.account,
    counts = { reads: 0, hints: 0, clear: 0 };
  let leases: typeof f.leases = [],
    now = f.now;
  const writes: unknown[] = [];
  const tx = {
    execute: () => {
      throw new Error('Injected canonical facts are supplied by the test port');
    },
    insert: () => {
      throw new Error('No insert allowed');
    },
  };
  const database: Pick<Database, 'messagingTypingStore'> = {
    messagingTypingStore: async (scope, budget, work) => {
      if (
        scope.actorId !== self.actorId ||
        scope.channelId !== f.channel.channelId ||
        budget !== 2
      )
        throw new Error('Misbound typing factory');
      return work({
        tx,
        fact: f.channel,
        accounts: f.accounts.map((row) => row.account),
        channels: f.channels,
        notify: async () => {
          counts.hints++;
        },
      });
    },
  };
  const operation = composeMessagingTyping({
    database,
    clock: { now: () => now },
    policy: f.policy,
    bounds: { ttlMs: 5000, refetchMs: 1000, maxActors: 2 },
    principal: { kind: 'user', userId: self.userId, actorId: self.actorId },
    readAccounts: async (current, accounts, instant) => {
      if (
        current !== tx ||
        JSON.stringify(accounts) !==
          JSON.stringify(f.accounts.map((row) => row.account)) ||
        instant !== now
      )
        throw new Error('Facts escaped caller fence');
      counts.reads++;
      now = '2026-10-10T12:00:01.000Z';
      return f.accounts;
    },
    redis: {
      readTypingLeases: async () => leases,
      writeTypingLease: async (lease, ttl) => {
        leases = [lease];
        writes.push([lease.expiresAt, ttl]);
      },
      clearTypingLease: async () => {
        leases = [];
        counts.clear++;
      },
    },
  });
  const start = await operation.update(f.channel.channelId, true),
    read = await operation.read(f.channel.channelId);
  await operation.update(f.channel.channelId, false);
  assert({
    given:
      'actual composed callbacks with current canonical fixture facts and producer-await clock movement',
    should:
      'bound TTL from fresh time, reuse same frame, preserve self exclusion and emit only transitions',
    actual: [start.typing, read.typing, writes, counts],
    expected: [
      false,
      false,
      [['2026-10-10T12:00:06.000Z', 5000]],
      { reads: 10, hints: 2, clear: 1 },
    ],
  });
});

function completingTransaction(completedAt: string) {
  const f = typingWorld(),
    self = f.accounts[0]!.account;
  let now = f.now;
  const evaluatedAt: string[] = [];
  const database: Pick<Database, 'messagingTypingStore'> = {
    messagingTypingStore: async (scope, budget, work) => {
      if (
        scope.actorId !== self.actorId ||
        scope.userId !== self.userId ||
        scope.channelId !== f.channel.channelId ||
        budget !== 2
      )
        throw new Error('Foreign completion scope');
      const result = await work({
        tx: {
          execute: () => {
            throw new Error('No SQL through injected fact reader');
          },
          insert: () => {
            throw new Error('No insert');
          },
        },
        fact: f.channel,
        accounts: f.accounts.map((row) => row.account),
        channels: f.channels,
        notify: async () => {},
      });
      // The actual store awaits COMMIT after its fenced callback.
      now = completedAt;
      return result;
    },
  };
  const operation = composeMessagingTyping({
    database,
    clock: { now: () => now },
    policy: {
      ...f.policy,
      reading: (input) => {
        evaluatedAt.push(input.now);
        return f.policy.reading(input);
      },
    },
    bounds: { ttlMs: 5000, refetchMs: 1000, maxActors: 2 },
    principal: { kind: 'user', userId: self.userId, actorId: self.actorId },
    readAccounts: async () => f.accounts,
    redis: {
      readTypingLeases: async () => [f.leases[1]!],
      writeTypingLease: async () => {},
      clearTypingLease: async () => {},
    },
  });
  return { f, operation, evaluatedAt };
}

test('transaction completion cannot disclose typing after sealed canonical evidence expires', async () => {
  for (const mutation of [false, true]) {
    const { f, operation, evaluatedAt } = completingTransaction(
      '2027-01-01T00:00:00.000Z',
    );
    await assertRejects({
      given: mutation
        ? 'a committed typing update completes after proof validity'
        : 'a committed typing read completes after proof validity',
      should:
        'consume the same sealed canonical authority at the post-transaction clock before HTTP projection',
      actual: () =>
        mutation
          ? operation.update(f.channel.channelId, true)
          : operation.read(f.channel.channelId),
      code: mutation ? 'AUTHORIZATION' : 'NOT_FOUND',
    });
    assert({
      given: 'expired authority after transaction completion',
      should: 'never synthesize a fresh policy proof outside its fence',
      actual: evaluatedAt.every((instant) => instant === f.now),
      expected: true,
    });
  }
});

test('post-transaction projection clears expired peer leases and shortens still-valid refresh timing', async () => {
  for (const [now, typing, refresh] of [
    ['2026-10-10T12:00:04.900Z', true, 100],
    ['2026-10-10T12:00:06.000Z', false, 1000],
  ] as const) {
    const { f, operation } = completingTransaction(now);
    const result = await operation.read(f.channel.channelId);
    assert({
      given: 'COMMIT completion while canonical reading remains valid',
      should:
        'project the actual remaining lease lifetime without stale typing',
      actual: [result.typing, result.refreshAfterMs],
      expected: [typing, refresh],
    });
  }
});
