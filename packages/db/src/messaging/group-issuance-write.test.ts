import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import {
  groupStoreFacts,
  groupWriteBellRows,
  groupWrittenBells,
} from './group-store.test-support';
import { writeGroupIssuance } from './group-issuance-write';
setupRitewayBun();
const { inviter, invitee, channelId, channel, now } = groupStoreFacts();
const scope = {
  actorId: inviter,
  userId: 'u'.repeat(24),
  requestId: 'r'.repeat(24),
  channelId,
  inviteeActorIds: [invitee],
};
const command = {
  digest: 'd'.repeat(64),
  now: now.toISOString(),
  maxMembers: 4,
  maxPendingInvitations: 2,
};
test('issuance writes exact generation and explicit subject receipt but never grants membership', async () => {
  const { client, queries } = fakeSql([
    [[invitee, 3, 'declined', now]],
    [[4]],
    [
      [
        channelId,
        'private_group',
        'social.private_group',
        1,
        'active',
        'Private title',
        inviter,
        0,
        3,
        1,
        now,
      ],
    ],
    [],
    ...groupWriteBellRows(),
  ]);
  const result = await writeGroupIssuance(
    drizzle({ client }),
    scope,
    channel(inviter, 'manager', 2),
    command,
  );
  const subjects = queries.find((q) =>
    q.query.startsWith('insert into "messaging_social_command_subjects"'),
  );
  const invitation = queries.find((q) =>
    q.query.startsWith('insert into "messaging_group_invitations"'),
  );
  const bells = groupWrittenBells(queries);
  assert({
    given: 'fresh manager proposal after a declined invitation',
    should:
      'renew exact generation, bind subject deletion, and emit only thin invalidations',
    actual: [
      result,
      invitation?.query.includes('"generation" ='),
      invitation?.params.includes(4),
      subjects?.params.includes(invitee),
      queries.some((q) =>
        q.query.includes('insert into "messaging_group_grants"'),
      ),
      bells,
    ],
    expected: [
      { channelId, lifecycle: 'active' },
      true,
      true,
      true,
      false,
      [
        { kind: 'channel.changed', channelId, changeVersion: 4 },
        { kind: 'messaging.inbox.changed' },
        { kind: 'messaging.inbox.changed' },
      ],
    ],
  });
});
test('pending invitation refusal leaves the production writer with only its locked read', async () => {
  const { client, queries } = fakeSql([[[invitee, 3, 'pending', now]]]);
  await assertRejects({
    given: 'same proposed actor already pending',
    should: 'refuse before invitation/receipt writes',
    actual: () =>
      writeGroupIssuance(
        drizzle({ client }),
        scope,
        channel(inviter, 'manager', 2),
        command,
      ),
    code: 'CONFLICT',
  });
  assert({
    given: 'effect conflict',
    should: 'perform only the invitation FOR UPDATE read',
    actual: [queries.length, queries[0]?.query.includes('for update')],
    expected: [1, true],
  });
});
