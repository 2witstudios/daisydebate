import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { inviteMessagingGroup } from './group-issuance';
import type { MessagingGroupIssuanceStore } from '@daisy/db/messaging';
setupRitewayBun();
const actorId = 'a'.repeat(24),
  channelId = 'c'.repeat(24),
  requestId = 'r'.repeat(24),
  invitee = 'b'.repeat(24);
const principal = {
  kind: 'user',
  userId: 'u'.repeat(24),
  actorId,
  member: true,
} as const;
const input = { version: 1, channelId, requestId, invitedActorIds: [invitee] };
const common = {
  bounds: { introductionUnits: 100, titleUnits: 80, batchActors: 4 },
  clock: { now: () => '2026-10-10T00:00:00.000Z' },
  limits: { maxMembers: 4, maxPendingInvitations: 2 },
  limit: async () => {},
};
test('fresh invitation produces minimal result and binds the original operation digest', async () => {
  let digest = '';
  let writes = 0;
  let limits = 0;
  const store: MessagingGroupIssuanceStore = {
    withIssuance: async (scope, work) =>
      work({
        readResult: async () => ({
          channelId: scope.channelId,
          lifecycle: 'active',
          receipt: null,
        }),
        commit: async (command) => {
          digest = command.digest;
          writes++;
          return { channelId, lifecycle: 'active' };
        },
      }),
  };
  const result = await inviteMessagingGroup(input, principal, {
    ...common,
    store,
    limit: async () => {
      limits++;
    },
  });
  const replay: MessagingGroupIssuanceStore = {
    withIssuance: async (_scope, work) =>
      work({
        readResult: async () => ({
          channelId,
          lifecycle: 'archived',
          receipt: { kind: 'group.invite', digest, channelId },
        }),
        commit: async () => {
          throw new Error('unexpected write');
        },
      }),
  };
  const closed = await inviteMessagingGroup(input, principal, {
    ...common,
    store: replay,
    limit: async () => {
      throw new Error('unexpected limiter');
    },
  });
  assert({
    given: 'actual committed issuance retry on archived group',
    should:
      'return minimal result without rerunning admission effects or limit',
    actual: [result, closed, writes, limits],
    expected: [
      { version: 1, channelId, lifecycle: 'active' },
      { version: 1, channelId, lifecycle: 'archived' },
      1,
      1,
    ],
  });
  await assertRejects({
    given: 'changed proposed invitees on same committed request',
    should: 'refuse mismatched original digest',
    actual: () =>
      inviteMessagingGroup(
        { ...input, invitedActorIds: ['z'.repeat(24)] },
        principal,
        { ...common, store: replay },
      ),
    code: 'CONFLICT',
  });
});
