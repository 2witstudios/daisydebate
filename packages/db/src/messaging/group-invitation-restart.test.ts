import { setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { createMessagingGroupInvitationStore } from './group-invitation-store';
import { groupStoreFacts } from './group-store.test-support';

setupRitewayBun();
const { invitee, channelId, accounts, channel, invitation } = groupStoreFacts();

test('a preview whose inviter keeps moving restarts twice, then answers a retryable outage', async () => {
  const attempt = [
    [invitation()],
    [{ fact: channel(invitee, null, 0, 2) }],
    accounts,
    [invitation('pending', 'f'.repeat(24))],
  ];
  const { client } = fakeSql([...attempt, ...attempt, ...attempt]);
  await assertRejects({
    given:
      'an inviter that changes between discovery and the fences on every attempt',
    should:
      'restart the read rather than answer 409, then refuse as INFRASTRUCTURE',
    actual: () =>
      createMessagingGroupInvitationStore({
        database: drizzle({ client }),
        authorize: async () => {
          throw new Error('must not authorize');
        },
      }).withInvitation(
        {
          channelId,
          actorId: invitee,
          userId: 'v'.repeat(24),
          inviteeActorId: invitee,
          operation: 'read',
          expectedGeneration: 3,
        },
        async () => {
          throw new Error('must not enter');
        },
      ),
    code: 'INFRASTRUCTURE',
  });
});
