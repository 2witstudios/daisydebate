import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type {
  AccountAuthorizationFact,
  AuthorizationPrincipal,
  MessagingPreferenceAuthorizationFact,
} from '@daisy/auth/authorization';
import { authorizeOwnPreferenceClear } from './preference-composition';
setupRitewayBun();
const input = {
  actorId: 'a'.repeat(24),
  userId: 'u'.repeat(24),
  channelId: 'c'.repeat(24),
};
const principal: AuthorizationPrincipal = {
  kind: 'user',
  userId: input.userId,
  actorId: input.actorId,
};
const account: AccountAuthorizationFact = {
  ...input,
  member: true,
  erased: false,
  revision: 2,
};
const fact: MessagingPreferenceAuthorizationFact = {
  kind: 'channel_preference',
  actorId: input.actorId,
  channelId: input.channelId,
};
test('actual preference clear composition allows only current own row or absent own collection', () => {
  assert({
    given: 'current self after channel grant/post/read loss',
    should:
      'allow own row deletion or absence no-op without a channel fact or policy',
    actual: [fact, null].map((row) =>
      authorizeOwnPreferenceClear(principal, input, {
        accounts: [account],
        fact: row,
      }),
    ),
    expected: [undefined, undefined],
  });
});
test('preference clear composition refuses foreign rows, stale identity and erased accounts', async () => {
  const cases: {
    principal: AuthorizationPrincipal;
    accounts: readonly (AccountAuthorizationFact | null)[];
    fact: MessagingPreferenceAuthorizationFact | null;
  }[] = [
    { principal: { kind: 'anonymous' }, accounts: [account], fact },
    {
      principal: { kind: 'user', userId: input.userId, actorId: null },
      accounts: [account],
      fact,
    },
    {
      principal: { ...principal, userId: 'x'.repeat(24) },
      accounts: [account],
      fact,
    },
    {
      principal,
      accounts: [account],
      fact: { ...fact, actorId: 'f'.repeat(24) },
    },
    { principal, accounts: [{ ...account, erased: true }], fact },
    { principal, accounts: [{ ...account, member: false }], fact: null },
    { principal, accounts: [null], fact },
  ];
  for (const row of cases)
    await assertRejects({
      given: 'a foreign or unavailable current self/row projection',
      should: 'refuse before own row deletion',
      actual: () => authorizeOwnPreferenceClear(row.principal, input, row),
      code: 'AUTHORIZATION',
    });
});
