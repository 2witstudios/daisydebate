import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { cleanupMessagingBrowserData } from '../src/messaging/browser-fixture';
import { createAuthorizationSubject } from './authorization.test-support';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('browser cleanup accepts owned group provenance and refuses foreign invitation associations atomically', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const owner = await createAuthorizationSubject(fixture);
    const peer = await createAuthorizationSubject(fixture);
    const foreign = await createAuthorizationSubject(fixture);
    const channelId = createId();
    const requestId = createId();
    const now = '2026-10-09T18:00:00.000Z';
    await fixture.insert('messaging_channels', {
      id: channelId,
      kind: 'private_group',
      policy_key: 'social.private_group',
      policy_revision: 1,
      lifecycle: 'active',
      title: 'Owned browser group',
      title_author_actor_id: owner.actorId,
    });
    await fixture.sql`insert into messaging_social_commands(actor_id,request_id,kind,result_channel_id,created_at) values(${owner.actorId},${requestId},'group.create',${channelId},${now})`;
    await fixture.sql`insert into messaging_group_grants(channel_id,actor_id,role,generation,granted_at) values(${channelId},${owner.actorId},'manager',1,${now})`;
    await fixture.sql`insert into messaging_group_invitations(channel_id,invitee_actor_id,invited_by_actor_id,generation,state,invited_at) values(${channelId},${foreign.actorId},${owner.actorId},1,'pending',${now})`;
    const accounts = [owner, peer].map((account) => ({
      ...account,
      username: account.userId,
    }));
    const assertRefused = async (given: string) => {
      let refusal: unknown;
      try {
        await cleanupMessagingBrowserData(fixture.sql, accounts, [channelId]);
      } catch (error) {
        refusal = error;
      }
      assert({
        given,
        should: 'refuse without deleting channel or creation provenance',
        actual: [
          refusal instanceof Error && refusal.message,
          await fixture.count('messaging_channels', 'id', channelId),
          await fixture.count(
            'messaging_social_commands',
            'request_id',
            requestId,
          ),
        ],
        expected: [
          'Messaging browser cleanup foreign contribution refused',
          1,
          1,
        ],
      });
    };
    try {
      await assertRefused(
        'an owned creation receipt with a foreign invitation',
      );
      await fixture.sql`delete from messaging_group_invitations where channel_id=${channelId}`;
      await fixture.sql`insert into messaging_group_invitations(channel_id,invitee_actor_id,invited_by_actor_id,generation,state,invited_at) values(${channelId},${peer.actorId},${owner.actorId},1,'pending',${now})`;
      await fixture.sql`insert into messaging_group_grants(channel_id,actor_id,role,generation,granted_at) values(${channelId},${foreign.actorId},'member',1,${now})`;
      await assertRefused(
        'an owned creation receipt with a foreign member grant',
      );
      await fixture.sql`delete from messaging_group_grants where channel_id=${channelId} and actor_id=${foreign.actorId}`;
      await fixture.sql`update messaging_social_commands set kind='group.archive' where actor_id=${owner.actorId} and request_id=${requestId}`;
      await assertRefused(
        'owned associations without durable group creation provenance',
      );
      await fixture.sql`update messaging_social_commands set kind='group.create' where actor_id=${owner.actorId} and request_id=${requestId}`;
      await cleanupMessagingBrowserData(fixture.sql, accounts, [channelId]);
      assert({
        given: 'only owned creator and invitation associations',
        should:
          'delete the declared group and its command while preserving foreign account',
        actual: [
          await fixture.count('messaging_channels', 'id', channelId),
          await fixture.count(
            'messaging_social_commands',
            'request_id',
            requestId,
          ),
          await fixture.count('actors', 'id', foreign.actorId),
        ],
        expected: [0, 0, 1],
      });
    } finally {
      await fixture.sql`delete from messaging_social_commands where actor_id=${owner.actorId} and request_id=${requestId}`;
      await fixture.sql`delete from messaging_channels where id=${channelId}`;
    }
  });
});
