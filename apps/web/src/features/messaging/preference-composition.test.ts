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

test('real preference factory binds separate channel fences and row-derived cleanup callback', async () => {
  const { composeMessagingPreferences } =
    await import('./preference-composition');
  const { messagingUnitPolicy } = await import('./typing.test-support');
  const calls: string[] = [];
  const tx = {
    execute: () => {
      throw new Error('No database call expected');
    },
    insert: () => {
      throw new Error('No insert expected');
    },
  };
  const channel = {
    kind: 'channel' as const,
    channelId: input.channelId,
    policyKey: 'social.dm' as const,
    policyRevision: 1,
    lifecycle: 'active' as const,
    revision: 1,
    authority: {
      kind: 'dm' as const,
      lowActorId: input.actorId,
      highActorId: 'b'.repeat(24),
      requestSenderActorId: input.actorId,
      state: 'accepted' as const,
      blocked: false,
      revision: 1,
    },
  };
  const database: Pick<
    import('@daisy/db').Database,
    'messagingPreferenceStore'
  > = {
    messagingPreferenceStore: (fences) => ({
      read: async (scope) => {
        calls.push('read');
        await fences.read(
          tx,
          { ...scope, userId: 'foreign'.repeat(3) },
          { fact: channel, accounts: [account] },
        );
        return { state: null, unread: 0 };
      },
      update: async (scope) => {
        calls.push('update');
        await fences.update(
          tx,
          { ...scope, actorId: 'f'.repeat(24) },
          { fact: channel, accounts: [account] },
        );
        return { state: null, unread: 0 };
      },
      clear: async (scope) => {
        await fences.clear(tx, scope, { accounts: [account], fact });
        calls.push('clear');
        return true;
      },
    }),
  };
  const store = composeMessagingPreferences({
    database,
    principal,
    clock: { now: () => '2026-10-10T12:00:00.000Z' },
    policy: messagingUnitPolicy(),
  });
  for (const operation of [
    () => store.read(input),
    () =>
      store.update(input, {
        following: false,
        hidden: false,
        notificationLevel: 'none',
      }),
  ])
    await assertRejects({
      given: 'misbound factory scope',
      should: 'refuse the appropriate channel fence before account-age I/O',
      actual: operation,
      code: 'AUTHORIZATION',
    });
  assert({
    given: 'actual row-bound clear callback',
    should:
      'allow only current self through canonical clear independently of channel fences',
    actual: [await store.clear(input), calls],
    expected: [true, ['read', 'update', 'clear']],
  });
});
