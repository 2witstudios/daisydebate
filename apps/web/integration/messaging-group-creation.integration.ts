import { closeMessagingGroupFixture } from './messaging-fixture.test-support';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import type { SocialCreationPolicy } from '@daisy/auth/authorization';
import { openMessagingFixture } from './messaging-fixture.test-support';
import {
  messagingFixturePosting,
  messagingFixtureReading,
} from './messaging-policy.test-support';
import { composeMessagingGroupCreationStore } from '../src/features/messaging/group-creation-composition';
import { createMessagingGroup } from '../src/features/messaging/create-group';
import { messagingSocialDigest } from '../src/features/messaging/social-command-digest';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const creationPolicy: SocialCreationPolicy = {
  state: 'approved',
  decision: 'Isolated creation proof only',
  key: 'social.private_group',
  revision: 1,
  allowedBandPairs: [['adult', 'adult']],
  groupBlockScope: 'all_pairs',
};
test('real group creation installs only creator authority and erases counterpart-bound command history', async () => {
  const f = await openMessagingFixture(databaseUrl);
  const channelId = createId(),
    requestId = createId(),
    unrelatedRequestId = createId();
  const clock = { now: () => f.fixture.now };
  const dependencies = {
    store: composeMessagingGroupCreationStore({
      database: f.database,
      principal: f.principal,
      clock,
      creationPolicy,
      postingPolicy: messagingFixturePosting,
      readingPolicy: messagingFixtureReading,
    }),
    bounds: { introductionUnits: 100, titleUnits: 80, batchActors: 10 },
    clock,
    policyRevision: 1,
    ids: { next: () => channelId },
    limit: async () => {},
  };
  const command = {
    version: 1,
    requestId,
    title: 'Shared surviving title',
    invitedActorIds: [f.fixture.otherActorId],
  };
  try {
    const result = await createMessagingGroup(
      command,
      f.principal,
      dependencies,
    );
    const replay = await createMessagingGroup(
      command,
      f.principal,
      dependencies,
    );
    const grants = await f.client.unsafe(
      'select actor_id,role,generation::int as generation from messaging_group_grants where channel_id=$1',
      [channelId],
    );
    const invitations = await f.client.unsafe(
      'select invitee_actor_id,state,generation::int as generation from messaging_group_invitations where channel_id=$1',
      [channelId],
    );
    assert({
      given: 'fresh creation and exact currently read-authorized replay',
      should:
        'create only creator authority and one pending invitee without renewing either generation',
      actual: [result, replay, [...grants], [...invitations]],
      expected: [
        { channelId, lifecycle: 'active' },
        { channelId, lifecycle: 'active' },
        [{ actor_id: f.fixture.actorId, role: 'manager', generation: 1 }],
        [
          {
            invitee_actor_id: f.fixture.otherActorId,
            state: 'pending',
            generation: 1,
          },
        ],
      ],
    });
    await assertRejects({
      given: 'an altered payload using the same owned creation receipt',
      should: 'refuse without repeating creation',
      actual: () =>
        createMessagingGroup(
          { ...command, title: 'Changed title' },
          f.principal,
          dependencies,
        ),
      code: 'CONFLICT',
    });
    await f.client.unsafe(
      "insert into messaging_social_commands(actor_id,request_id,kind,digest,result_channel_id,created_at) values($1,$2,'group.archive',$3,$4,$5)",
      [
        f.fixture.actorId,
        unrelatedRequestId,
        messagingSocialDigest('group.archive', [channelId]),
        channelId,
        f.fixture.now,
      ],
    );
    await f.fixture.eraseSubject(f.fixture.otherActorId);
    const [remaining] = await f.client.unsafe(
      `select
      (select count(*)::int from messaging_social_commands where actor_id=$1 and request_id=$2) as creation,
      (select count(*)::int from messaging_social_command_subjects where actor_id=$1 and request_id=$2) as associations,
      (select count(*)::int from messaging_group_invitations where channel_id=$3) as invitations,
      (select count(*)::int from messaging_social_commands where actor_id=$1 and request_id=$4) as unrelated,
      (select count(*)::int from messaging_group_grants where channel_id=$3 and actor_id=$1 and revoked_at is null) as creator,
      (select title from messaging_channels where id=$3) as title`,
      [f.fixture.actorId, requestId, channelId, unrelatedRequestId],
    );
    assert({
      given: 'canonical invitee erasure after a multi-target private command',
      should:
        'delete the bound command and subject associations while preserving unrelated creator state and shared title',
      actual: remaining,
      expected: {
        creation: 0,
        associations: 0,
        invitations: 0,
        unrelated: 1,
        creator: 1,
        title: command.title,
      },
    });
  } finally {
    await f.client.unsafe(
      'delete from messaging_social_commands where actor_id=$1 and request_id in ($2,$3)',
      [f.fixture.actorId, requestId, unrelatedRequestId],
    );
    await closeMessagingGroupFixture(f, channelId);
  }
});
