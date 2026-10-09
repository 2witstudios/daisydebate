import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type { AuthorizationInput } from '@daisy/auth/authorization';
import { requireMessagingAuthorization } from './authorization';

setupRitewayBun();
const actorId = 'a'.repeat(24);
const otherId = 'b'.repeat(24);
const channelId = 'c'.repeat(24);
const userId = 'u'.repeat(24);
const policy = {
  channelId,
  policyKey: 'social.dm',
  policyRevision: 1,
  authorityRevision: 1,
  relationshipRevision: 1,
  allowed: true,
};
const input: AuthorizationInput = {
  principal: { kind: 'user', userId, actorId },
  capability: 'channel.post',
  resource: {
    kind: 'channel',
    channelId,
    policyKey: policy.policyKey,
    policyRevision: 1,
    lifecycle: 'active',
    revision: 1,
    authority: {
      kind: 'dm',
      lowActorId: actorId,
      highActorId: otherId,
      requestSenderActorId: actorId,
      state: 'accepted',
      blocked: false,
      revision: 1,
    },
  },
  context: {
    account: { userId, actorId, member: true, erased: false, revision: 1 },
    socialReading: policy,
    socialPosting: policy,
  },
};

test('current shared authority protects reads and sends with different refusal surfaces', async () => {
  assert({
    given: 'fresh accepted pair and approved current policy evidence',
    should: 'allow a send through the shared evaluator',
    actual: requireMessagingAuthorization(input),
    expected: undefined,
  });
  await assertRejects({
    given: 'missing reading policy evidence',
    should: 'conceal a protected channel read',
    actual: () =>
      requireMessagingAuthorization({
        ...input,
        capability: 'channel.read',
        context: { account: input.context.account, socialPosting: policy },
      }),
    code: 'NOT_FOUND',
  });
  await assertRejects({
    given: 'an erased account',
    should: 'refuse sends before protected replay',
    actual: () =>
      requireMessagingAuthorization({
        ...input,
        context: {
          ...input.context,
          account: { ...input.context.account!, erased: true },
        },
      }),
    code: 'AUTHORIZATION',
  });
});

test('a block preserves independent history policy but prevents posting and retries', async () => {
  if (
    input.resource.kind !== 'channel' ||
    input.resource.authority.kind !== 'dm'
  )
    throw new Error('DM fixture required');
  const blocked = {
    ...input,
    resource: {
      ...input.resource,
      authority: { ...input.resource.authority, blocked: true },
    },
  };
  assert({
    given: 'a blocked DM and current retained-history policy',
    should: 'permit its separately authorized history',
    actual: requireMessagingAuthorization({
      ...blocked,
      capability: 'channel.read',
    }),
    expected: undefined,
  });
  await assertRejects({
    given: 'the same blocked channel',
    should: 'deny a protected send result including retry',
    actual: () => requireMessagingAuthorization(blocked),
    code: 'AUTHORIZATION',
  });
  await assertRejects({
    given: 'policy proof from before a contact revision',
    should: 'deny stale policy evidence',
    actual: () =>
      requireMessagingAuthorization({
        ...blocked,
        resource: {
          ...blocked.resource,
          authority: { ...blocked.resource.authority, revision: 2 },
        },
      }),
    code: 'AUTHORIZATION',
  });
});
