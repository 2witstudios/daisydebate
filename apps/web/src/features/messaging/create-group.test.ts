import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import type { MessagingGroupCreationStore } from '@daisy/db/messaging';
import { createMessagingGroup } from './create-group';
setupRitewayBun();
test('group creation never allocates identifiers before fresh prospective authorization', async () => {
  const calls: string[] = [];
  const store: MessagingGroupCreationStore = {
    withCreation: async (_scope, work) =>
      work({
        readResult: async () => null,
        authorize: async () => {
          calls.push('authorize');
          throw createAppError('AUTHORIZATION');
        },
        commit: async () => {
          throw new Error('No writes');
        },
      }),
  };
  await assertRejects({
    given: 'a refused current group proposal',
    should: 'refuse before limiter, identifiers or writes',
    actual: () =>
      createMessagingGroup(
        {
          version: 1,
          requestId: 'r'.repeat(24),
          title: 'Private group',
          invitedActorIds: ['i'.repeat(24)],
        },
        { kind: 'user', userId: 'u'.repeat(24), actorId: 'a'.repeat(24) },
        proofDependencies(store, calls),
      ),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'refused admission',
    should: 'leave the allocation boundary untouched',
    actual: calls,
    expected: ['authorize'],
  });
});

test('group creation rechecks after limiting and protects current owned result replay', async () => {
  const principal = {
    kind: 'user' as const,
    userId: 'u'.repeat(24),
    actorId: 'a'.repeat(24),
  };
  const command = {
    version: 1 as const,
    requestId: 'r'.repeat(24),
    title: 'Private group',
    invitedActorIds: ['i'.repeat(24)],
  };
  const { messagingSocialDigest } = await import('./social-command-digest');
  const digest = messagingSocialDigest('group.create', [
    command.title,
    command.invitedActorIds,
  ]);
  for (const mode of [
    'revoked',
    'replay',
    'conflict',
    'foreign-result',
  ] as const) {
    const calls: string[] = [];
    let attempts = 0;
    const store: MessagingGroupCreationStore = {
      withCreation: async (_scope, work) =>
        work({
          readResult: async () =>
            mode === 'replay' || mode === 'conflict'
              ? {
                  kind: 'group.create',
                  digest: mode === 'conflict' ? 'changed' : digest,
                  channelId: 'g'.repeat(24),
                  lifecycle: 'archived',
                }
              : null,
          authorize: async () => {
            calls.push('authorize');
            if (++attempts === 2 && mode === 'revoked')
              throw createAppError('AUTHORIZATION');
          },
          commit: async () => {
            calls.push('commit');
            return { channelId: 'f'.repeat(24), lifecycle: 'active' };
          },
        }),
    };
    const run = () =>
      createMessagingGroup(command, principal, proofDependencies(store, calls));
    if (mode === 'replay')
      assert({
        given: 'an already fresh read-authorized owned creation receipt',
        should:
          'return minimal current archived result without new admission or writes',
        actual: [await run(), calls],
        expected: [{ channelId: 'g'.repeat(24), lifecycle: 'archived' }, []],
      });
    else
      await assertRejects({
        given: mode,
        should: 'refuse without returning a stale or foreign creation result',
        actual: run,
        code:
          mode === 'revoked'
            ? 'AUTHORIZATION'
            : mode === 'conflict'
              ? 'CONFLICT'
              : 'INFRASTRUCTURE',
      });
    if (mode === 'revoked')
      assert({
        given: 'admission lost during the limiter wait',
        should: 'allocate no channel identifier',
        actual: calls,
        expected: ['authorize', 'limit', 'authorize'],
      });
  }
});

function proofDependencies(
  store: MessagingGroupCreationStore,
  calls: string[],
) {
  return {
    store,
    bounds: { introductionUnits: 20, titleUnits: 20, batchActors: 3 },
    policyRevision: 1,
    clock: { now: () => '2026-10-09T01:00:00.000Z' },
    ids: {
      next: () => {
        calls.push('id');
        return 'g'.repeat(24);
      },
    },
    limit: async () => {
      calls.push('limit');
    },
  };
}
