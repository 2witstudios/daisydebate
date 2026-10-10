import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import type { MessagingGroupInvitationStore } from '@daisy/db/messaging';
import { decideMessagingGroupInvitation } from './group-invitation';
import { messagingSocialDigest } from './social-command-digest';
setupRitewayBun();
const channelId = 'c'.repeat(24),
  actorId = 'i'.repeat(24),
  inviterActorId = 'm'.repeat(24);
const principal = { kind: 'user' as const, userId: 'u'.repeat(24), actorId };
const command = {
  version: 1 as const,
  channelId,
  requestId: 'r'.repeat(24),
  expectedGeneration: 2,
  decision: 'decline' as const,
};
const bounds = { introductionUnits: 20, titleUnits: 20, batchActors: 3 };
const digest = messagingSocialDigest('group.invitation.decide', [
  channelId,
  actorId,
  2,
  'decline',
]);
function fixture(
  options: {
    closed?: boolean;
    digest?: string;
    counterpart?: string;
    generation?: number;
    revoked?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const store: MessagingGroupInvitationStore = {
    withInvitation: async (scope, work) => {
      calls.push(scope.operation);
      return work({
        preview: async () => {
          throw new Error('No preview');
        },
        readDecisionState: async () => ({
          channelId,
          generation: options.generation ?? 2,
          state: options.closed ? 'declined' : 'pending',
          invitedAt: '2026-10-09T00:00:00.000Z',
          inviterActorId,
          receipt: options.closed
            ? {
                kind: 'group.decide',
                digest: options.digest ?? digest,
                channelId,
                counterpartActorId: options.counterpart ?? inviterActorId,
              }
            : null,
        }),
        commitDecision: async () => {
          calls.push('fresh-write');
          if (options.revoked) throw createAppError('AUTHORIZATION');
          return { channelId, generation: 2, state: 'declined' };
        },
      });
    },
  };
  return {
    calls,
    dependencies: {
      store,
      bounds,
      clock: { now: () => '2026-10-09T01:00:00.000Z' },
      limit: async () => {
        calls.push('limit');
      },
    },
  };
}
test('group refusal and closed own receipt retry expose only generation and state', async () => {
  for (const closed of [false, true]) {
    const { calls, dependencies } = fixture({ closed });
    const result = await decideMessagingGroupInvitation(
      'decide',
      command,
      principal,
      dependencies,
    );
    assert({
      given: closed ? 'a bound closed own receipt' : 'a fresh pending refusal',
      should: 'return only minimal state without admission or repeated writes',
      actual: [result, calls],
      expected: [
        { channelId, generation: 2, state: 'declined' },
        closed ? ['decline'] : ['decline', 'limit', 'fresh-write'],
      ],
    });
  }
});
test('group retry binds exact generation digest and actual counterpart', async () => {
  for (const options of [
    { generation: 3 },
    { closed: true, digest: 'foreign' },
    { closed: true, counterpart: 'f'.repeat(24) },
  ]) {
    const { calls, dependencies } = fixture(options);
    await assertRejects({
      given: 'a stale or foreign original command receipt',
      should: 'refuse before limiter and writes',
      actual: () =>
        decideMessagingGroupInvitation(
          'decide',
          command,
          principal,
          dependencies,
        ),
      code: 'CONFLICT',
    });
    assert({
      given: 'the refused command',
      should: 'leave protected writes uncalled',
      actual: calls,
      expected: ['decline'],
    });
  }
});
test('group decision propagates fresh fence revocation after limiter wait', async () => {
  const { calls, dependencies } = fixture({ revoked: true });
  await assertRejects({
    given: 'authority lost after the pending read',
    should: 'refuse the write rather than return a successful decision',
    actual: () =>
      decideMessagingGroupInvitation(
        'decide',
        command,
        principal,
        dependencies,
      ),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'the attempted operation',
    should: 'reach the fresh write fence only after rate limiting',
    actual: calls,
    expected: ['decline', 'limit', 'fresh-write'],
  });
});
