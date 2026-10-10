import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type { Database } from '@daisy/db';
import { composeMessagingTyping } from './typing-operations';
import { typingWorld } from './typing.test-support';
setupRitewayBun();
test('actual typing composition refuses current unavailable members before Redis and never uses a second transaction', async () => {
  const f = typingWorld(),
    account = f.accounts[0]!.account;
  const observed: unknown[] = [];
  const tx = {
    execute: () => {
      throw new Error('Age SQL unavailable for nonmembers');
    },
    insert: () => {
      throw new Error('No insert allowed');
    },
  };
  const database: Pick<Database, 'messagingTypingStore'> = {
    messagingTypingStore: async (scope, budget, work) => {
      observed.push([scope, budget]);
      return work({
        tx,
        fact: f.channel,
        accounts: f.accounts.map((row) => ({ ...row.account, member: false })),
        channels: f.channels,
        notify: async () => {
          observed.push('hint');
        },
      });
    },
  };
  const operation = composeMessagingTyping({
    database,
    clock: { now: () => f.now },
    principal: {
      kind: 'user',
      userId: account.userId,
      actorId: account.actorId,
    },
    policy: f.policy,
    bounds: { ttlMs: 5000, refetchMs: 1000, maxActors: 2 },
    redis: {
      readTypingLeases: async () => {
        observed.push('read');
        return [];
      },
      writeTypingLease: async () => {
        observed.push('write');
      },
      clearTypingLease: async () => {
        observed.push('clear');
      },
    },
  });
  for (const [run, code] of [
    [() => operation.update(f.channel.channelId, true), 'AUTHORIZATION'],
    [() => operation.read(f.channel.channelId), 'NOT_FOUND'],
  ] as const)
    await assertRejects({
      given: 'fresh account fence reports unavailable member',
      should: 'deny without Redis lease read/write or hint',
      actual: run,
      code,
    });
  assert({
    given: 'actual composed DB port callbacks for read/write',
    should: 'bind only current self/channel and explicit technical budget',
    actual: observed,
    expected: Array(2).fill([
      {
        userId: account.userId,
        actorId: account.actorId,
        channelId: f.channel.channelId,
      },
      2,
    ]),
  });
});
