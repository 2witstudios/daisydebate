import { composeMessagingGroupIssuanceStore } from '../src/features/messaging/group-issuance-composition';
import { inviteMessagingGroup } from '../src/features/messaging/group-issuance';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import {
  messagingTestGroupPolicy,
  messagingTestGroupReading,
} from '@daisy/auth/testing';
import { openMessagingParticipants } from './messaging-fixture.test-support';
import { composeMessagingGroupCreationStore } from '../src/features/messaging/group-creation-composition';
import { createMessagingGroup } from '../src/features/messaging/create-group';
import { composeMessagingGroupManagementStore } from '../src/features/messaging/group-management-composition';
import { manageMessagingGroup } from '../src/features/messaging/group-management';
import { composeMessagingGroupInvitationStore } from '../src/features/messaging/group-invitation-composition';
import { decideMessagingGroupInvitation } from '../src/features/messaging/group-invitation';
import { messagingAuthorizationFence } from '../src/features/messaging/authorization-fence';
import { createMessagingReadOperations } from '../src/features/messaging/read';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const bounds = { introductionUnits: 100, titleUnits: 80, batchActors: 10 };
test('real management transfers, revokes history, preserves survivor authority and safely archives before last manager leaves', async () => {
  const f = await openMessagingParticipants(databaseUrl),
    channelId = createId();
  const clock = { now: () => f.fixture.now },
    limit = async () => {};
  const createStore = composeMessagingGroupCreationStore({
    database: f.database,
    principal: f.sender,
    clock,
    creationPolicy: messagingTestGroupPolicy,
    postingPolicy: messagingTestGroupPolicy,
    readingPolicy: messagingTestGroupReading,
  });
  const dependencies = (principal: typeof f.sender) => ({
    store: composeMessagingGroupManagementStore({
      database: f.database,
      principal,
      clock,
      postingPolicy: messagingTestGroupPolicy,
      readingPolicy: messagingTestGroupReading,
    }),
    bounds,
    clock,
    limit,
  });
  const issuance = (principal: typeof f.sender) => ({
    store: composeMessagingGroupIssuanceStore({
      database: f.database,
      principal,
      clock,
      policy: messagingTestGroupPolicy,
    }),
    bounds,
    clock,
    limit,
    limits: { maxMembers: 4, maxPendingInvitations: 2 },
  });
  const command = (extra: Record<string, unknown> = {}) => ({
    version: 1,
    channelId,
    requestId: createId(),
    ...extra,
  });
  const decide = (decision: 'accept' | 'decline', expectedGeneration: number) =>
    decideMessagingGroupInvitation(
      'decide',
      { ...command(), expectedGeneration, decision },
      f.recipient,
      {
        store: composeMessagingGroupInvitationStore({
          database: f.database,
          principal: f.recipient,
          clock,
          admissionPolicy: messagingTestGroupPolicy,
        }),
        bounds,
        clock,
        limit,
      },
    );
  try {
    await createMessagingGroup(
      {
        version: 1,
        requestId: createId(),
        title: 'Management proof',
        invitedActorIds: [f.recipient.actorId],
      },
      f.sender,
      {
        store: createStore,
        bounds,
        clock,
        limit,
        ids: { next: () => channelId },
        policyRevision: 1,
      },
    );
    await decide('decline', 1);
    const renewed = command({ invitedActorIds: [f.recipient.actorId] });
    await inviteMessagingGroup(renewed, f.sender, issuance(f.sender));
    const pendingRetry = command({ invitedActorIds: [f.recipient.actorId] });
    await assertRejects({
      given: 'already pending invitation is reissued under a new receipt',
      should: 'refuse rather than replace the pending generation',
      actual: () =>
        inviteMessagingGroup(pendingRetry, f.sender, issuance(f.sender)),
      code: 'CONFLICT',
    });
    const unchanged = await f.client.unsafe(
      'select generation::int as generation,state from messaging_group_invitations where channel_id=$1',
      [channelId],
    );
    const absent = await f.client.unsafe(
      'select request_id from messaging_social_commands where actor_id=$1 and request_id=$2',
      [f.sender.actorId, pendingRetry.requestId],
    );
    assert({
      given: 'real transaction refusal after pair/channel locks',
      should:
        'preserve renewed generation and rollback all refused command effects',
      actual: [
        [...unchanged].map((row) => [row.generation, row.state]),
        absent.length,
      ],
      expected: [[[2, 'pending']], 0],
    });
    await decide('accept', 2);
    await assertRejects({
      given: 'only active manager attempts leave',
      should: 'preserve required manager',
      actual: () =>
        manageMessagingGroup(
          'leave',
          command(),
          f.sender,
          dependencies(f.sender),
        ),
      code: 'CONFLICT',
    });
    const transfer = command({ managerActorId: f.recipient.actorId });
    await manageMessagingGroup(
      'transfer',
      transfer,
      f.sender,
      dependencies(f.sender),
    );
    const renewalReplay = await inviteMessagingGroup(
      renewed,
      f.sender,
      issuance(f.sender),
    );
    assert({
      given:
        'committed invite retry after original manager loses manager authority',
      should: 'return only its minimal own result without invitation admission',
      actual: renewalReplay,
      expected: { version: 1, channelId, lifecycle: 'active' },
    });
    const replay = await manageMessagingGroup(
      'transfer',
      transfer,
      f.sender,
      dependencies(f.sender),
    );
    await assertRejects({
      given: 'former manager attempts remove',
      should: 'deny current role despite old receipt',
      actual: () =>
        manageMessagingGroup(
          'remove',
          command({ memberActorId: f.recipient.actorId }),
          f.sender,
          dependencies(f.sender),
        ),
      code: 'AUTHORIZATION',
    });
    const remove = command({ memberActorId: f.sender.actorId });
    await manageMessagingGroup(
      'remove',
      remove,
      f.recipient,
      dependencies(f.recipient),
    );
    const read = (principal: typeof f.sender) =>
      createMessagingReadOperations({
        bounds: { messageUnits: 1000, pageItems: 20 },
        store: f.database.messagingChannelStore(
          messagingAuthorizationFence({
            principal,
            capability: 'channel.read',
            clock,
            postingPolicy: messagingTestGroupPolicy,
            groupPostingPolicy: messagingTestGroupPolicy,
            readingPolicy: messagingTestGroupReading,
          }),
        ),
      }).history({ version: 1, channelId, limit: 10 }, principal);
    await assertRejects({
      given: 'removed member asks durable history',
      should: 'deny current grant',
      actual: () => read(f.sender),
      code: 'NOT_FOUND',
    });
    const history = await read(f.recipient);
    await f.client.unsafe('delete from account_age where user_id=$1', [
      f.fixture.otherUserId,
    ]);
    const archive = command();
    const archived = await manageMessagingGroup(
      'archive',
      archive,
      f.recipient,
      dependencies(f.recipient),
    );
    const archiveReplay = await manageMessagingGroup(
      'archive',
      archive,
      f.recipient,
      dependencies(f.recipient),
    );
    const leave = command();
    await manageMessagingGroup(
      'leave',
      leave,
      f.recipient,
      dependencies(f.recipient),
    );
    const leaveReplay = await manageMessagingGroup(
      'leave',
      leave,
      f.recipient,
      dependencies(f.recipient),
    );
    const rows = await f.client.unsafe(
      'select actor_id,role,generation::int as generation,revoked_at is not null as revoked from messaging_group_grants where channel_id=$1 order by actor_id',
      [channelId],
    );
    assert({
      given:
        'transfer/remove followed by unavailable age, archive and final leave',
      should:
        'preserve survivor read before leave, exact minimal replay, and revoked generations',
      actual: [
        replay.lifecycle,
        history.channelId,
        archived.lifecycle,
        archiveReplay.lifecycle,
        leaveReplay.lifecycle,
        [...rows].every((row) => row.revoked === true),
        rows.length,
      ],
      expected: [
        'active',
        channelId,
        'archived',
        'archived',
        'archived',
        true,
        2,
      ],
    });
    await f.fixture.eraseSubject(f.recipient.actorId);
    const [erasedInvitation] = await f.client.unsafe(
      `select
      (select count(*)::int from messaging_social_commands where actor_id=$1 and request_id=$2) as receipts,
      (select count(*)::int from messaging_social_command_subjects where actor_id=$1 and request_id=$2) as subjects,
      (select count(*)::int from messaging_group_grants where channel_id=$3 and actor_id=$4) as erased_grants,
      (select title from messaging_channels where id=$3) as shared_title`,
      [f.sender.actorId, renewed.requestId, channelId, f.recipient.actorId],
    );
    assert({
      given:
        'canonical erasure of the renewed invitee after management and leave',
      should:
        'delete receipt subjects and grants while preserving the unowned shared title',
      actual: erasedInvitation,
      expected: {
        receipts: 0,
        subjects: 0,
        erased_grants: 0,
        shared_title: 'Management proof',
      },
    });
    await assertRejects({
      given: 'old issuance retry after its subject associations are erased',
      should: 'refuse without recreating invitation or contact authority',
      actual: () => inviteMessagingGroup(renewed, f.sender, issuance(f.sender)),
      code: 'AUTHORIZATION',
    });
  } finally {
    await f.client.unsafe('delete from outbox where topic=$1', [
      `channel:${channelId}`,
    ]);
    await f.client.unsafe('delete from messaging_channels where id=$1', [
      channelId,
    ]);
    await f.fixture.cleanup();
    await f.database.close();
    await f.client.close();
  }
}, 180000);
