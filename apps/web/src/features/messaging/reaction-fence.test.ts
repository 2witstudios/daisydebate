import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createScriptedAuthorizationTransaction } from '@daisy/db/testing';
import { messagingReactionFence } from './reaction-fence';
import { policyFactQuery, typingWorld } from './typing.test-support';
setupRitewayBun();
function fixture(contactUnavailable = false) {
  const f = typingWorld(),
    self = f.accounts[0]!.account;
  if (f.channel.authority.kind !== 'dm')
    throw new Error('Accepted DM fixture required');
  // Unknown ages: the contact facts are never read.
  const { tx, queries } = createScriptedAuthorizationTransaction(
    contactUnavailable
      ? [
          ...f.accounts.map((row) => [row.age]),
          new Error('DM contact facts unavailable'),
        ]
      : [],
  );
  const channel = {
    ...f.channel,
    lifecycle: contactUnavailable ? ('active' as const) : ('archived' as const),
    authority: { ...f.channel.authority, blocked: !contactUnavailable },
  };
  const scope = {
    actorId: self.actorId,
    userId: self.userId,
    channelId: channel.channelId,
  };
  const association = {
    actorId: self.actorId,
    channelId: channel.channelId,
    messageId: 'm'.repeat(24),
    reaction: '👍',
  };
  const fence = messagingReactionFence({
    principal: { kind: 'user', userId: self.userId, actorId: self.actorId },
    clock: { now: () => f.now },
    postingPolicy: f.policy.posting,
    readingPolicy: f.policy.reading,
  });
  const authority = {
    fact: channel,
    accounts: f.accounts.map((row) => row.account),
  };
  return { tx, queries, fence, scope, association, authority };
}
test('reaction reads and own removals bypass unavailable contact facts', async () => {
  const read = fixture(true);
  const remove = fixture(true);
  await read.fence(read.tx, read.scope, read.authority, 'read');
  await remove.fence(
    remove.tx,
    remove.scope,
    remove.authority,
    'remove',
    remove.association,
  );
  assert({
    given: 'an accepted DM with known ages and an unavailable contact query',
    should:
      'authorize reading reactions and removing the member’s own reaction without loading contact facts',
    actual: [read.queries.length, remove.queries.length],
    expected: [2, 2],
  });
});
test('own reaction cleanup consumes actual canonical reading with blocked archived unknown-age history', async () => {
  const f = fixture();
  await f.fence(f.tx, f.scope, f.authority, 'remove', f.association);
  await f.fence(f.tx, f.scope, f.authority, 'read');
  await assertRejects({
    given: 'the same blocked archived channel with unavailable posting age',
    should:
      'refuse a new addition without making cleanup or reading a write grant',
    actual: () => f.fence(f.tx, f.scope, f.authority, 'add'),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'canonical account-fenced minimal facts for each operation',
    should: 'reuse the same adapter and expose no raw birth query',
    actual: [
      f.queries.length,
      f.queries.every((query) => policyFactQuery(query.query)),
    ],
    expected: [6, true],
  });
});
test('reaction cleanup refuses missing or foreign associations instead of deriving a removal fact from intent', async () => {
  const f = fixture();
  await assertRejects({
    given: 'an absent own association',
    should: 'never invent a grant from deletion intent',
    actual: () => f.fence(f.tx, f.scope, f.authority, 'remove'),
    code: 'NOT_FOUND',
  });
  await assertRejects({
    given: 'an existing row owned by another participant',
    should: 'deny through the sole canonical own-association evaluator',
    actual: () =>
      f.fence(f.tx, f.scope, f.authority, 'remove', {
        ...f.association,
        actorId: 'b'.repeat(24),
      }),
    code: 'AUTHORIZATION',
  });
});
