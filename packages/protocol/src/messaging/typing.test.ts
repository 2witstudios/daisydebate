import { assert, setupRitewayBun, test } from 'riteway/bun';
import { messagingTypingSchemas } from './typing';
setupRitewayBun();
const channelId = 'c'.repeat(24);
test('typing HTTP is a strict aggregate with explicit refresh and no actor or content fields', () => {
  const result = { version: 1, channelId, typing: true, refreshAfterMs: 500 };
  assert({
    given: 'a current aggregate and injected timing bounds',
    should: 'accept only thin result and explicit write intent',
    actual: [
      messagingTypingSchemas.result.safeParse(result).success,
      messagingTypingSchemas.update.safeParse({
        version: 1,
        channelId,
        typing: false,
      }).success,
      ...[
        { ...result, actorId: 'a'.repeat(24) },
        { ...result, text: 'secret' },
        { ...result, refreshAfterMs: 0 },
      ].map((value) => messagingTypingSchemas.result.safeParse(value).success),
    ],
    expected: [true, true, false, false, false],
  });
});
test('typing lease and timing reject unbound or unbounded persisted values', () => {
  const lease = {
    version: 1,
    channelId,
    actorId: 'a'.repeat(24),
    authorityRevision: 2,
    relationshipRevision: 3,
    accountRevision: 4,
    ageRevision: 5,
    policyRevision: 1,
    expiresAt: '2026-10-10T12:00:01.000Z',
  };
  assert({
    given: 'a canonical revision-bound lease and explicit configuration',
    should:
      'reject missing authority, wrong lifetime and absent timing choices',
    actual: [
      messagingTypingSchemas.lease.safeParse(lease).success,
      messagingTypingSchemas.lease.safeParse({ ...lease, accountRevision: 0 })
        .success,
      messagingTypingSchemas.lease.safeParse({ ...lease, ageRevision: null })
        .success,
      messagingTypingSchemas.policy.safeParse({
        ttlMs: 1000,
        refetchMs: 500,
        maxActors: 2,
      }).success,
      messagingTypingSchemas.policy.safeParse({
        ttlMs: 1000,
        refetchMs: 2000,
        maxActors: 2,
      }).success,
      messagingTypingSchemas.policy.safeParse({}).success,
    ],
    expected: [true, false, false, true, false, false],
  });
});
