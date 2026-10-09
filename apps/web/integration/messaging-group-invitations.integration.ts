import { composeMessagingInbox } from '../src/features/messaging/inbox-composition';
import {
  messagingFixturePosting,
  messagingFixtureReading,
} from './messaging-policy.test-support';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type { SocialCreationPolicy } from '@daisy/auth/authorization';
import { openMessagingFixture } from './messaging-fixture.test-support';
import { composeMessagingGroupInvitationStore } from '../src/features/messaging/group-invitation-composition';
import {
  readMessagingGroupInvitation,
  decideMessagingGroupInvitation,
} from '../src/features/messaging/group-invitation';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const bounds = { introductionUnits: 100, titleUnits: 80, batchActors: 10 };
const admissionPolicy: SocialCreationPolicy = {
  state: 'approved',
  decision: 'Isolated group invitation fixture only',
  key: 'social.private_group',
  revision: 1,
  allowedBandPairs: [['adult', 'adult']],
  groupBlockScope: 'all_pairs',
};
async function fixture() {
  const base = await openMessagingFixture(databaseUrl);
  const channelId = createId();
  try {
    await base.client.unsafe(
      "insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle,title) values($1,'private_group','social.private_group',1,'active','Private fixture title')",
      [channelId],
    );
    await base.client.unsafe(
      "insert into messaging_group_grants(channel_id,actor_id,role,generation,granted_at) values($1,$2,'manager',1,$3)",
      [channelId, base.fixture.actorId, base.fixture.now],
    );
    await base.client.unsafe(
      "insert into messaging_group_invitations(channel_id,channel_kind,invitee_actor_id,invited_by_actor_id,generation,state,invited_at) values($1,'private_group',$2,$3,1,'pending',$4)",
      [
        channelId,
        base.fixture.otherActorId,
        base.fixture.actorId,
        base.fixture.now,
      ],
    );
  } catch (error) {
    await base.client.unsafe('delete from messaging_channels where id=$1', [
      channelId,
    ]);
    await base.fixture.cleanup();
    await base.database.close();
    await base.client.close();
    throw error;
  }
  const principal = {
    kind: 'user' as const,
    userId: base.fixture.otherUserId,
    actorId: base.fixture.otherActorId,
  };
  const clock = { now: () => base.fixture.now };
  const dependencies = (approved: boolean) => ({
    store: composeMessagingGroupInvitationStore({
      database: base.database,
      principal,
      clock,
      ...(approved ? { admissionPolicy } : {}),
    }),
    bounds,
    clock,
    limit: async () => {},
  });
  return {
    ...base,
    channelId,
    principal,
    dependencies,
    async cleanup() {
      await base.client.unsafe('delete from messaging_channels where id=$1', [
        channelId,
      ]);
      await base.client.unsafe(
        "delete from outbox where payload->>'channelId'=$1",
        [channelId],
      );
      await base.fixture.cleanup();
      await base.database.close();
      await base.client.close();
    },
  };
}
test('real group acceptance needs explicit admission and closed own retries never renew grants', async () => {
  const f = await fixture();
  const command = {
    version: 1,
    channelId: f.channelId,
    requestId: createId(),
    expectedGeneration: 1,
    decision: 'accept',
  };
  try {
    const inbox = composeMessagingInbox({
      database: f.database,
      principal: f.principal,
      clock: { now: () => f.fixture.now },
      postingPolicy: messagingFixturePosting,
      readingPolicy: messagingFixtureReading,
    });
    const pendingPage = await inbox.read({ limit: 10 });
    assert({
      given: 'a real own pending invitation and no group grant',
      should:
        'discover only minimal invitation navigation after its distinct current capability',
      actual: pendingPage.entries.filter(
        (entry) => entry.channelId === f.channelId,
      ),
      expected: [{ channelId: f.channelId, kind: 'incoming_invitation' }],
    });
    const preview = await readMessagingGroupInvitation(
      { version: 1, channelId: f.channelId },
      f.principal,
      f.dependencies(false),
    );
    assert({
      given: 'a pending invitation without reading/posting/admission approval',
      should: 'return minimal association metadata without the shared title',
      actual: preview,
      expected: { channelId: f.channelId, generation: 1, state: 'pending' },
    });
    await assertRejects({
      given: 'missing approved group admission',
      should: 'refuse accepting without writing a grant',
      actual: () =>
        decideMessagingGroupInvitation(
          'decide',
          command,
          f.principal,
          f.dependencies(false),
        ),
      code: 'AUTHORIZATION',
    });
    const accepted = await decideMessagingGroupInvitation(
      'decide',
      command,
      f.principal,
      f.dependencies(true),
    );
    const replay = await decideMessagingGroupInvitation(
      'decide',
      command,
      f.principal,
      f.dependencies(false),
    );
    const grants = await f.client.unsafe(
      'select role,generation from messaging_group_grants where channel_id=$1 and actor_id=$2',
      [f.channelId, f.principal.actorId],
    );
    assert({
      given:
        'fresh acceptance and exact closed receipt replay without admission policy',
      should: 'return minimal accepted result and one grant generation',
      actual: [
        accepted,
        replay,
        grants.map((row: { role: string; generation: number }) => [
          row.role,
          Number(row.generation),
        ]),
      ],
      expected: [
        { channelId: f.channelId, generation: 1, state: 'accepted' },
        { channelId: f.channelId, generation: 1, state: 'accepted' },
        [['member', 1]],
      ],
    });
    await assertRejects({
      given: 'a changed closed command request ID',
      should: 'refuse without treating a result grant as a repeated acceptance',
      actual: () =>
        decideMessagingGroupInvitation(
          'decide',
          { ...command, requestId: createId() },
          f.principal,
          f.dependencies(true),
        ),
      code: 'AUTHORIZATION',
    });
  } finally {
    await f.cleanup();
  }
});
test('real blocked archived invitation may be declined without age or manager admission', async () => {
  const f = await fixture();
  try {
    await f.client.unsafe(
      "update messaging_channels set lifecycle='archived',authority_revision=authority_revision+1 where id=$1",
      [f.channelId],
    );
    await f.client.unsafe(
      'update messaging_group_grants set revoked_at=$2,generation=generation+1 where channel_id=$1',
      [f.channelId, f.fixture.now],
    );
    await f.client.unsafe(
      'update messaging_contact_pairs set low_blocks_high=true,revision=revision+1 where low_actor_id=$1 and high_actor_id=$2',
      [f.fixture.low, f.fixture.high],
    );
    await f.client.unsafe('delete from account_age where user_id in ($1,$2)', [
      f.fixture.userId,
      f.fixture.otherUserId,
    ]);
    const command = {
      version: 1,
      channelId: f.channelId,
      requestId: createId(),
      expectedGeneration: 1,
      decision: 'decline',
    };
    const result = await decideMessagingGroupInvitation(
      'decide',
      command,
      f.principal,
      f.dependencies(false),
    );
    const grants = await f.client.unsafe(
      'select actor_id from messaging_group_grants where channel_id=$1 and actor_id=$2',
      [f.channelId, f.principal.actorId],
    );
    assert({
      given:
        'revoked inviter, blocked pair, archived channel and unavailable age',
      should:
        'permit only the invited self refusal without granting membership',
      actual: [result, grants.length],
      expected: [
        { channelId: f.channelId, generation: 1, state: 'declined' },
        0,
      ],
    });
  } finally {
    await f.cleanup();
  }
});
