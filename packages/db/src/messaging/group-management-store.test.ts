import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { groupStoreFacts } from './group-store.test-support';
import { createMessagingGroupManagementStore } from './group-management-store';
setupRitewayBun();
const { inviter, channelId, accounts, channel } = groupStoreFacts();
const requestId = 'r'.repeat(24),
  digest = 'd'.repeat(64);
const scope = {
  userId: 'u'.repeat(24),
  actorId: inviter,
  channelId,
  requestId,
  operation: 'leave' as const,
};
const fact = channel(inviter, 'manager', 2);
function wire(receipt: readonly unknown[][] = []) {
  return fakeSql([
    [{ fact }],
    accounts,
    [{ locked: true }],
    [{ fact }],
    receipt,
  ]);
}
test('management result supplies actual own committed receipt to canonical fence before projection', async () => {
  const { client, queries } = wire([
    [inviter, requestId, 'group.leave', digest, channelId],
  ]);
  let received: unknown;
  const result = await createMessagingGroupManagementStore({
    database: drizzle({ client }),
    authorize: async (_tx, _scope, facts) => {
      received = facts.receipt;
    },
  }).withManagement(scope, (frame) => frame.readResult());
  assert({
    given: 'own committed receipt under ordered account/channel locks',
    should: 'bind minimal result and exact receipt to canonical authorization',
    actual: [result, received, queries.at(-1)?.params],
    expected: [
      {
        channelId,
        lifecycle: 'active',
        receipt: {
          actorId: inviter,
          requestId,
          kind: 'group.leave',
          digest,
          channelId,
        },
      },
      { actorId: inviter, requestId, kind: 'group.leave', digest, channelId },
      [inviter, requestId],
    ],
  });
});
test('canonical refusal prevents receipt projection and all management writes', async () => {
  const { client, queries } = wire();
  await assertRejects({
    given: 'denied current leave authority',
    should: 'refuse without mutation',
    actual: () =>
      createMessagingGroupManagementStore({
        database: drizzle({ client }),
        authorize: async () => {
          throw createAppError('AUTHORIZATION');
        },
      }).withManagement(scope, (frame) => frame.readResult()),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'canonical denial',
    should: 'issue no durable write',
    actual: queries.some((q) => /insert into|update /.test(q.query)),
    expected: false,
  });
});
test('commit requires observed absent receipt and rechecks authority after consumer wait', async () => {
  const { client, queries } = wire();
  let fences = 0;
  await createMessagingGroupManagementStore({
    database: drizzle({ client }),
    authorize: async () => {
      fences++;
      if (fences === 2) throw createAppError('AUTHORIZATION');
    },
  }).withManagement(scope, async (frame) => {
    const command = { digest, now: '2026-10-10T06:00:00.000Z' };
    await assertRejects({
      given: 'no observed receipt',
      should: 'refuse unbound write',
      actual: () => frame.commit(command),
      code: 'CONFLICT',
    });
    await frame.readResult();
    await assertRejects({
      given: 'fresh refusal after wait',
      should: 'refuse before effect query',
      actual: () => frame.commit(command),
      code: 'AUTHORIZATION',
    });
  });
  assert({
    given: 'fresh refusal',
    should: 'evaluate twice without writes',
    actual: [fences, queries.some((q) => /insert into|update /.test(q.query))],
    expected: [2, false],
  });
});
