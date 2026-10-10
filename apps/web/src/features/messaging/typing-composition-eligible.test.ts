import { assert, setupRitewayBun, test } from 'riteway/bun';
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
      { reads: 8, hints: 2, clear: 1 },
    ],
  });
});
