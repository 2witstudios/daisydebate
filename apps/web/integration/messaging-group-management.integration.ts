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
  const command = (extra: Record<string, unknown> = {}) => ({
    version: 1,
    channelId,
    requestId: createId(),
    ...extra,
  });
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
    await decideMessagingGroupInvitation(
      'decide',
      { ...command(), expectedGeneration: 1, decision: 'accept' },
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
