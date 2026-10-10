import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { messagingAuthorizationFence } from './authorization-fence';
import { typingWorld } from './typing.test-support';
import { createScriptedAuthorizationTransaction } from '@daisy/db/testing';
setupRitewayBun();
test('channel authorization fences reject misbound channel projections before age I/O', async () => {
  const f = typingWorld(),
    self = f.accounts[0]!.account;
  let queries = 0;
  const fence = messagingAuthorizationFence({
    principal: { kind: 'user', userId: self.userId, actorId: self.actorId },
    capability: 'channel.read',
    clock: { now: () => f.now },
    postingPolicy: f.policy.posting,
    readingPolicy: f.policy.reading,
  });
  await assertRejects({
    given: 'a correctly bound principal but a foreign scoped frame channel',
    should: 'refuse the inconsistent boundary before reading private age facts',
    actual: () =>
      fence(
        {
          execute: () => {
            queries++;
            throw new Error('Misbound frame must refuse before age I/O');
          },
          insert: () => {
            throw new Error('No insert');
          },
        },
        {
          actorId: self.actorId!,
          userId: self.userId,
          channelId: 'x'.repeat(24),
        },
        { fact: f.channel, accounts: f.accounts.map((row) => row.account) },
      ),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'a misbound projection',
    should: 'never load age facts',
    actual: queries,
    expected: 0,
  });
});

test('channel fences consume minimal facts at the clock after their awaited producer returns', async () => {
  const f = typingWorld(),
    self = f.accounts[0]!.account;
  const { tx, queries } = createScriptedAuthorizationTransaction(
    f.accounts.map((row) => [row.age]),
  );
  const completedAt = '2026-10-10T12:00:01.000Z';
  let readingAt = '';
  const fence = messagingAuthorizationFence({
    principal: { kind: 'user', userId: self.userId, actorId: self.actorId },
    capability: 'channel.read',
    clock: { now: () => (queries.length ? completedAt : f.now) },
    postingPolicy: f.policy.posting,
    readingPolicy: (input) => {
      readingAt = input.now;
      return f.policy.reading(input);
    },
  });
  await fence(
    tx,
    {
      actorId: self.actorId!,
      userId: self.userId,
      channelId: f.channel.channelId,
    },
    { fact: f.channel, accounts: f.accounts.map((row) => row.account) },
  );
  assert({
    given: 'a minimal age SQL producer returns after clock movement',
    should:
      'evaluate current policy at consumption time on the same injected adapter',
    actual: [
      readingAt,
      queries.length,
      queries.every((query) => query.query.includes('daisy_authorization_age')),
    ],
    expected: [completedAt, 2, true],
  });
});
