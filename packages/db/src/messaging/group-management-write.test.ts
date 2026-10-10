import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import {
  groupStoreFacts,
  groupWriteBellRows,
  groupWrittenBells,
} from './group-store.test-support';
import { writeGroupManagement } from './group-management-write';
import { parseMessagingChannelFact } from './social';
setupRitewayBun();
const { inviter, invitee, channelId, channel, now } = groupStoreFacts();
const fact = parseMessagingChannelFact(channel(inviter, 'manager', 2));
const base = {
  actorId: inviter,
  userId: 'u'.repeat(24),
  channelId,
  requestId: 'r'.repeat(24),
};
const command = { digest: 'd'.repeat(64), now: now.toISOString() };
const row = (lifecycle: string) => [
  channelId,
  'private_group',
  'social.private_group',
  1,
  lifecycle,
  'Private title',
  inviter,
  0,
  3,
  1,
  now,
];
for (const operation of ['remove', 'transfer', 'archive'] as const)
  test(`management ${operation} writes scoped effects and only thin bells`, async () => {
    const updates =
      operation === 'archive'
        ? []
        : operation === 'transfer'
          ? [[[inviter]], [[invitee]]]
          : [[[invitee]]];
    const { client, queries } = fakeSql([
      [
        [inviter, 'manager', 2, now],
        [invitee, 'member', 4, now],
      ],
      ...updates,
      [],
      [row(operation === 'archive' ? 'archived' : 'active')],
      ...groupWriteBellRows(),
    ]);
    const result = await writeGroupManagement(
      drizzle({ client }),
      {
        ...base,
        operation,
        ...(operation === 'archive' ? {} : { targetActorId: invitee }),
      },
      fact,
      command,
    );
    const grants = queries.filter((q) =>
      q.query.startsWith('update "messaging_group_grants"'),
    );
    const bells = groupWrittenBells(queries);
    assert({
      given: `fresh ${operation} authority with two current grants`,
      should:
        'write only exact grant/channel/receipt scopes and content-free invalidations',
      actual: [
        result,
        grants.length,
        grants.every(
          (q) =>
            q.query.includes('"generation" =') &&
            q.query.includes('"revoked_at" is null'),
        ),
        bells,
      ],
      expected: [
        {
          channelId,
          lifecycle: operation === 'archive' ? 'archived' : 'active',
        },
        updates.length,
        true,
        [
          { kind: 'channel.changed', channelId, changeVersion: 4 },
          { kind: 'messaging.inbox.changed' },
          { kind: 'messaging.inbox.changed' },
        ],
      ],
    });
  });
test('last active manager leave refuses before any mutation', async () => {
  const { client, queries } = fakeSql([[[inviter, 'manager', 2, now]]]);
  await assertRejects({
    given: 'only active manager leaves',
    should: 'require transfer or archive first',
    actual: () =>
      writeGroupManagement(
        drizzle({ client }),
        { ...base, operation: 'leave' },
        fact,
        command,
      ),
    code: 'CONFLICT',
  });
  assert({
    given: 'last-manager refusal',
    should: 'leave grants, invitations, channel and receipts untouched',
    actual: queries.length,
    expected: 1,
  });
});
