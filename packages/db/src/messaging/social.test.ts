import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { canonicalContactPair, parseMessagingChannelFact } from './social';

setupRitewayBun();
const actorId = 'a'.repeat(24);
const otherId = 'b'.repeat(24);
const channelId = 'c'.repeat(24);
const dm = {
  kind: 'channel' as const,
  channelId,
  policyKey: 'social.dm' as const,
  policyRevision: 1,
  lifecycle: 'active' as const,
  revision: 1,
  authority: {
    kind: 'dm' as const,
    lowActorId: actorId,
    highActorId: otherId,
    requestSenderActorId: actorId,
    state: 'pending' as const,
    blocked: false,
    revision: 1,
  },
};

test('contact pair canonicalization is independent of caller order', () => {
  assert({
    given: 'the same two actors in opposite orders',
    should: 'share one pair fence',
    actual: canonicalContactPair(otherId, actorId),
    expected: canonicalContactPair(actorId, otherId),
  });
});

test('fresh projections carry authority only and refuse corrupt association facts', async () => {
  assert({
    given: 'a pending request from the durable pair',
    should: 'preserve request sender and state for shared authorization',
    actual: parseMessagingChannelFact(dm),
    expected: dm,
  });
  for (const patch of [
    { policyKey: 'social.private_group' },
    { revision: 0 },
    { authority: { ...dm.authority, lowActorId: otherId } },
    { authority: { ...dm.authority, requestSenderActorId: channelId } },
    { authority: { ...dm.authority, revision: 0 } },
    { following: true },
  ]) {
    await assertRejects({
      given: JSON.stringify(patch),
      should: 'fail closed on invalid persistence projections',
      actual: () =>
        Promise.resolve(parseMessagingChannelFact({ ...dm, ...patch })),
      code: 'INFRASTRUCTURE',
    });
  }
});

test('a revoked or absent group grant does not become access from preferences', () => {
  const group = {
    kind: 'channel' as const,
    channelId,
    policyKey: 'social.private_group' as const,
    policyRevision: 1,
    lifecycle: 'active' as const,
    revision: 3,
    authority: {
      kind: 'private_group' as const,
      actorId,
      role: null,
      generation: 2,
      activeMemberActorIds: [otherId],
    },
  };
  assert({
    given: 'a revoked grant generation',
    should: 'preserve a null role for the one shared evaluator',
    actual: parseMessagingChannelFact(group).authority,
    expected: group.authority,
  });
});
