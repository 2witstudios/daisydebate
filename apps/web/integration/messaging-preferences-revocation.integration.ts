import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import {
  messagingTestGroupPolicy,
  messagingTestGroupReading,
} from '@daisy/auth/testing';
import {
  openMessagingParticipants,
  closeMessagingGroupFixture,
} from './messaging-fixture.test-support';
import { messagingRoutePolicy } from './messaging-route.test-support';
import { composeMessagingPreferences } from '../src/features/messaging/preference-composition';
import { composeMessagingGroupCreationStore } from '../src/features/messaging/group-creation-composition';
import { createMessagingGroup } from '../src/features/messaging/create-group';
import { composeMessagingGroupInvitationStore } from '../src/features/messaging/group-invitation-composition';
import { decideMessagingGroupInvitation } from '../src/features/messaging/group-invitation';
import { composeMessagingGroupManagementStore } from '../src/features/messaging/group-management-composition';
import { manageMessagingGroup } from '../src/features/messaging/group-management';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const selections = {
  following: false,
  hidden: false,
  notificationLevel: 'none' as const,
};
test('actual group revocation conceals followed preferences while own existing-row clear remains available', async () => {
  const f = await openMessagingParticipants(databaseUrl),
    channelId = createId();
  const clock = { now: () => f.fixture.now },
    bounds = { introductionUnits: 100, titleUnits: 80, batchActors: 10 },
    limit = async () => {};
  const policy = {
    ...messagingRoutePolicy,
    groupPosting: messagingTestGroupPolicy,
    reading: messagingTestGroupReading,
  };
  const preferences = composeMessagingPreferences({
    database: f.database,
    principal: f.recipient,
    policy,
    clock,
  });
  const scope = {
    userId: f.recipient.userId,
    actorId: f.recipient.actorId,
    channelId,
  };
  try {
    await createMessagingGroup(
      {
        version: 1,
        requestId: createId(),
        title: 'Preferences proof',
        invitedActorIds: [f.recipient.actorId],
      },
      f.sender,
      {
        store: composeMessagingGroupCreationStore({
          database: f.database,
          principal: f.sender,
          clock,
          creationPolicy: messagingTestGroupPolicy,
          postingPolicy: messagingTestGroupPolicy,
          readingPolicy: messagingTestGroupReading,
        }),
        bounds,
        clock,
        limit,
        ids: { next: () => channelId },
        policyRevision: 1,
      },
    );
    await decideMessagingGroupInvitation(
      'decide',
      {
        version: 1,
        channelId,
        requestId: createId(),
        expectedGeneration: 1,
        decision: 'accept',
      },
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
    await preferences.update(scope, { ...selections, following: true });
    await manageMessagingGroup(
      'remove',
      {
        version: 1,
        requestId: createId(),
        channelId,
        memberActorId: f.recipient.actorId,
      },
      f.sender,
      {
        store: composeMessagingGroupManagementStore({
          database: f.database,
          principal: f.sender,
          clock,
          postingPolicy: messagingTestGroupPolicy,
          readingPolicy: messagingTestGroupReading,
        }),
        bounds,
        clock,
        limit,
      },
    );
    await assertRejects({
      given: 'actually removed but still-followed group member',
      should:
        'conceal preference metadata without treating following as a grant',
      actual: () => preferences.read(scope),
      code: 'NOT_FOUND',
    });
    await assertRejects({
      given: 'removed actor updating saved preferences',
      should: 'refuse without recreating membership',
      actual: () => preferences.update(scope, selections),
      code: 'AUTHORIZATION',
    });
    const cleared = await preferences.clear(scope),
      again = await preferences.clear(scope);
    const [remaining] = await f.client.unsafe(
      'select count(*)::int as count from messaging_actor_states where actor_id=$1 and channel_id=$2',
      [scope.actorId, channelId],
    );
    assert({
      given: 'an existing own preference after revocation',
      should: 'delete it once without upsert or content permission',
      actual: [cleared, again, remaining?.count],
      expected: [true, false, 0],
    });
  } finally {
    await closeMessagingGroupFixture(f, channelId);
  }
}, 180000);
