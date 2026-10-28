import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  discoverySpends,
  openRecordedMember,
} from '../account/username-discovery.test-support';
import { composeMessagingRoutes } from './composition';
import { isolatedMessagingPolicy } from './isolated-policy.test-support';

setupRitewayBun();

const me = 'a'.repeat(24),
  requestId = 'r'.repeat(24),
  channelId = 'c'.repeat(24);

test('Messaging’s username routes resolve every name through discovery, once per name', async () => {
  const policy = isolatedMessagingPolicy();
  const looked: string[] = [];
  const member = await openRecordedMember(
    me,
    'messaging-usernames@daisy.example.com',
    composeMessagingRoutes,
    {
      messagingPolicy: policy,
      database: {
        lookupHumanActorByUsername: async (username: string) => {
          looked.push(username);
          return username === 'ghost' ? null : 'b'.repeat(24);
        },
      },
    },
  );
  const social = policy.social.abuse.map((rule) => [
    `messaging:social:${me}:${rule.windowSeconds}`,
    rule,
  ]);
  try {
    const dm = await member.routes.requestByUsername(
      member.post('/api/messaging/requests/username', {
        version: 1,
        requestId,
        recipientUsername: 'ghost',
      }),
    );
    const afterDm = member.spent.splice(0);
    await member.routes.inviteGroup(
      member.post(`/api/messaging/channels/${channelId}/invitations`, {
        version: 1,
        requestId,
        channelId,
        invitedUsernames: ['peer_one', 'peer_two'],
      }),
    );
    const afterInvite = member.spent.splice(0);
    await member.routes.manageGroup(
      member.post(`/api/messaging/channels/${channelId}/management`, {
        version: 1,
        requestId,
        channelId,
        operation: 'remove',
        memberUsername: 'peer_one',
      }),
    );
    assert({
      given:
        'a DM request to an unknown name, a two-name group invite and a removal by username',
      should:
        'spend discovery before each lookup (once per name), after each route’s own budget',
      actual: [dm.status, afterDm, afterInvite, member.spent, looked],
      expected: [
        403,
        discoverySpends(me),
        [...social, ...discoverySpends(me), ...discoverySpends(me)],
        [...social, ...discoverySpends(me)],
        ['ghost', 'peer_one', 'peer_two', 'peer_one'],
      ],
    });
  } finally {
    await member.close();
  }
});
