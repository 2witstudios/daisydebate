import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { groupStoreFacts } from './group-store.test-support';
import { createMessagingGroupIssuanceStore } from './group-issuance-store';
setupRitewayBun();
const { inviter, invitee, channelId, channel, accounts } = groupStoreFacts();
const fact = channel(inviter, 'manager', 2),
  requestId = 'r'.repeat(24),
  digest = 'd'.repeat(64);
const scope = {
  actorId: inviter,
  userId: 'u'.repeat(24),
  channelId,
  requestId,
  inviteeActorIds: [invitee],
};
test('closed issuance replay uses actual own receipt and never materializes proposed contacts', async () => {
  const { client, queries } = fakeSql([
    [{ fact }],
    accounts,
    [[inviter, requestId, 'group.invite', digest, channelId]],
    [{ locked: true }],
    [{ fact }],
  ]);
  let projected: unknown;
  const result = await createMessagingGroupIssuanceStore({
    database: drizzle({ client }),
    authorize: async (_tx, _scope, facts) => {
      projected = [facts.receipt, facts.contactPairs];
    },
  }).withIssuance(scope, (frame) => frame.readResult());
  assert({
    given: 'committed issuance after current manager grant changes',
    should:
      'project only actual receipt and avoid invitation/admission side effects',
    actual: [
      result,
      projected,
      queries.some((q) => /insert into|update /.test(q.query)),
    ],
    expected: [
      {
        channelId,
        lifecycle: 'active',
        receipt: { kind: 'group.invite', digest, channelId },
      },
      [
        {
          actorId: inviter,
          requestId,
          kind: 'group.invite',
          digest,
          channelId,
        },
        [],
      ],
      false,
    ],
  });
});
test('prospective canonical refusal leaves invitation and command writes absent', async () => {
  const { client, queries } = prospectiveDriver();
  await assertRejects({
    given: 'fresh proposed invitation refusal',
    should: 'refuse without creating invitation/grant/receipt',
    actual: () =>
      createMessagingGroupIssuanceStore({
        database: drizzle({ client }),
        authorize: async () => {
          throw createAppError('AUTHORIZATION');
        },
      }).withIssuance(scope, (frame) => frame.readResult()),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'refused prospective accounts/policy',
    should: 'leave invitation/grant/command effects to no writer',
    actual: queries.some((q) =>
      /insert into "messaging_(group_invitations|group_grants|social_commands)"/.test(
        q.query,
      ),
    ),
    expected: false,
  });
});

test('issuance rechecks the canonical fence immediately before effects after a reader wait', async () => {
  const { client, queries } = prospectiveDriver();
  let fences = 0;
  await assertRejects({
    given: 'read succeeded but fresh commit policy refuses',
    should: 'recheck before any invitation or receipt mutation',
    actual: () =>
      createMessagingGroupIssuanceStore({
        database: drizzle({ client }),
        authorize: async () => {
          fences++;
          if (fences === 2) throw createAppError('AUTHORIZATION');
        },
      }).withIssuance(scope, async (frame) => {
        await frame.readResult();
        return frame.commit({
          digest,
          now: '2026-10-10T00:00:00.000Z',
          maxMembers: 4,
          maxPendingInvitations: 2,
        });
      }),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'current policy refusal on commit',
    should:
      'perform both fences and leave personal invitation/receipt effects absent',
    actual: [
      fences,
      queries.some((q) =>
        /insert into "messaging_(group_invitations|social_commands)"/.test(
          q.query,
        ),
      ),
    ],
    expected: [2, false],
  });
});

function prospectiveDriver() {
  return fakeSql([
    [{ fact }],
    accounts,
    [],
    [],
    [{ low_blocks_high: false, high_blocks_low: false, revision: 1 }],
    [{ locked: true }],
    [{ fact }],
  ]);
}
