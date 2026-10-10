import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from '../index.test-support';
import { createMessagingGroupInvitationStore } from './group-invitation-store';
import type { MessagingGroupInvitationScope } from './group-invitation-contracts';
import { groupStoreFacts } from './group-store.test-support';
setupRitewayBun();
const { inviter, invitee, channelId, accounts, channel, now, invitation } =
  groupStoreFacts();
const requestId = 'r'.repeat(24);
const base: MessagingGroupInvitationScope = {
  channelId,
  actorId: invitee,
  userId: 'v'.repeat(24),
  inviteeActorId: invitee,
  operation: 'read',
  expectedGeneration: 3,
};
const fact = channel(invitee, null, 0, 2);
const manager = channel(inviter, 'manager', 2, 2);
function wire(tail: Parameters<typeof fakeSql>[0], state = 'pending') {
  return fakeSql([
    [invitation(state)],
    [{ fact }],
    accounts,
    [invitation(state)],
    [{ low_blocks_high: false, high_blocks_low: true, revision: 4 }],
    [{ locked: true }],
    [{ fact }],
    ...tail,
  ]);
}

test('pending preview exposes only invitation state after ordered fresh authority, never title/history/grant', async () => {
  const { client, queries } = wire([[invitation()], [{ fact: manager }]]);
  let projected: unknown;
  const result = await createMessagingGroupInvitationStore({
    database: drizzle({ client }),
    authorize: async (_tx, _scope, operation, current) => {
      projected = [
        operation,
        current.invitation,
        current.accounts.map((a) => a?.actorId),
      ];
    },
  }).withInvitation(base, (frame) => frame.preview());
  assert({
    given: 'an actual pending invitation and blocked contact pair',
    should: 'project current metadata and manager facts to canonical read only',
    actual: [result, projected],
    expected: [
      { channelId, generation: 3, state: 'pending' },
      [
        'read',
        {
          kind: 'group_invitation',
          channel: {
            channelId,
            kind: 'private_group',
            policyKey: 'social.private_group',
            policyRevision: 1,
            revision: 2,
            lifecycle: 'active',
            activeMemberActorIds: [inviter],
          },
          invitation: {
            channelId,
            inviterActorId: inviter,
            inviteeActorId: invitee,
            generation: 3,
            state: 'pending',
          },
          inviterGrant: { actorId: inviter, role: 'manager', generation: 2 },
          contactPairs: [
            {
              lowActorId: inviter,
              highActorId: invitee,
              blocked: true,
              revision: 4,
            },
          ],
          expectedGeneration: 3,
        },
        [inviter, invitee],
      ],
    ],
  });
  assert({
    given: 'metadata-only reader',
    should:
      'lock accounts then pairs then channel without content or grant writes',
    actual: [
      queries[2]?.query.includes('daisy_authorization_accounts'),
      queries[4]?.query.includes('for update'),
      queries[5]?.query.includes('daisy_messaging_channel_fence'),
      queries.some((q) =>
        /messaging_messages|insert into|update /.test(q.query),
      ),
    ],
    expected: [true, true, true, false],
  });
});

for (const state of ['pending', 'declined'])
  test(`decision state ${state} uses current canonical capability before own receipt`, async () => {
    const { client, queries } = wire(
      [
        [invitation(state)],
        [invitation(state)],
        [{ fact: manager }],
        [['group.decide', 'd'.repeat(64), channelId, inviter]],
      ],
      state,
    );
    const modes: string[] = [];
    const result = await createMessagingGroupInvitationStore({
      database: drizzle({ client }),
      authorize: async (_tx, _scope, mode) => {
        modes.push(mode);
      },
    }).withInvitation({ ...base, operation: 'decline' }, async (frame) => {
      await assertRejects({
        given: 'mutation frame used as preview',
        should: 'refuse operation mismatch',
        actual: () => frame.preview(),
        code: 'CONFLICT',
      });
      await assertRejects({
        given: 'different request decision',
        should: 'refuse before receipt query',
        actual: () => frame.readDecisionState(requestId, 'accept'),
        code: 'VALIDATION',
      });
      return frame.readDecisionState(requestId, 'decline');
    });
    assert({
      given: 'current pending/closed state',
      should:
        'use decision/result capability and actor/request-bound minimal receipt',
      actual: [modes, result, queries.at(-1)?.params],
      expected: [
        [state === 'pending' ? 'decline' : 'result'],
        {
          channelId,
          generation: 3,
          state,
          invitedAt: now.toISOString(),
          inviterActorId: inviter,
          receipt: {
            kind: 'group.decide',
            digest: 'd'.repeat(64),
            channelId,
            counterpartActorId: inviter,
          },
        },
        [invitee, requestId],
      ],
    });
  });

test('canonical denial does not read the private command receipt or mutate pending invitation', async () => {
  const { client, queries } = wire([
    [invitation()],
    [invitation()],
    [{ fact: manager }],
  ]);
  await assertRejects({
    given: 'fresh denied invitation decision',
    should: 'refuse before receipt payload',
    actual: () =>
      createMessagingGroupInvitationStore({
        database: drizzle({ client }),
        authorize: async () => {
          throw createAppError('AUTHORIZATION');
        },
      }).withInvitation({ ...base, operation: 'decline' }, (frame) =>
        frame.readDecisionState(requestId, 'decline'),
      ),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'canonical refusal',
    should: 'leave receipt and durable state untouched',
    actual: queries.some((q) =>
      /messaging_social_commands|insert into|update /.test(q.query),
    ),
    expected: false,
  });
});

for (const scenario of [
  'absent',
  'changed-inviter',
  'invalid-invitee',
] as const)
  test(`invitation discovery refuses ${scenario}`, async () => {
    const script =
      scenario === 'absent'
        ? [[]]
        : [
            [invitation()],
            [{ fact }],
            accounts,
            [invitation('pending', 'f'.repeat(24))],
          ];
    const { client, queries } = fakeSql(script);
    await assertRejects({
      given: 'missing, changed or malformed invitation association',
      should: 'refuse without handing authority to consumer',
      actual: () =>
        createMessagingGroupInvitationStore({
          database: drizzle({ client }),
          authorize: async () => {
            throw new Error('must not authorize');
          },
        }).withInvitation(
          {
            ...base,
            ...(scenario === 'invalid-invitee'
              ? { inviteeActorId: 'invalid' }
              : {}),
          },
          async () => {
            throw new Error('must not enter');
          },
        ),
      code:
        scenario === 'absent'
          ? 'NOT_FOUND'
          : scenario === 'invalid-invitee'
            ? 'VALIDATION'
            : 'CONFLICT',
    });
    assert({
      given: 'discovery refusal',
      should: 'not acquire channel lock or touch content',
      actual: queries.some((q) =>
        /daisy_messaging_channel_fence|messaging_messages/.test(q.query),
      ),
      expected: false,
    });
  });

test('commit requires the exact observed request/decision and rechecks authority after observation', async () => {
  const { client, queries } = wire([
    [invitation()],
    [invitation()],
    [{ fact: manager }],
    [],
    [invitation()],
    [{ fact: manager }],
  ]);
  let fences = 0;
  await createMessagingGroupInvitationStore({
    database: drizzle({ client }),
    authorize: async () => {
      fences += 1;
      if (fences === 2) throw createAppError('AUTHORIZATION');
    },
  }).withInvitation({ ...base, operation: 'decline' }, async (frame) => {
    const command = {
      requestId,
      decision: 'decline' as const,
      digest: 'd'.repeat(64),
      now: now.toISOString(),
    };
    await assertRejects({
      given: 'unobserved receipt',
      should: 'refuse mutation',
      actual: () => frame.commitDecision(command),
      code: 'CONFLICT',
    });
    await frame.readDecisionState(requestId, 'decline');
    await assertRejects({
      given: 'different retry identity',
      should: 'refuse mutation',
      actual: () =>
        frame.commitDecision({ ...command, requestId: 's'.repeat(24) }),
      code: 'CONFLICT',
    });
    await assertRejects({
      given: 'authority revoked after state read',
      should: 'recheck before updating invitation',
      actual: () => frame.commitDecision(command),
      code: 'AUTHORIZATION',
    });
  });
  assert({
    given: 'observed decision followed by fresh refusal',
    should: 'evaluate twice with no durable updates',
    actual: [fences, queries.some((q) => /insert into|update /.test(q.query))],
    expected: [2, false],
  });
});
