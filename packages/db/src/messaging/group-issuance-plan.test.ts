import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { planGroupIssuance } from './group-issuance-plan';
setupRitewayBun();
const actor = 'a'.repeat(24),
  invitee = 'b'.repeat(24),
  now = '2026-10-10T00:00:00.000Z';
const base = {
  actorId: actor,
  inviteeActorIds: [invitee],
  activeMemberActorIds: [actor],
  previous: [],
  now,
  maxMembers: 3,
  maxPendingInvitations: 2,
};
test('renewal advances a closed invitation without inventing membership', () => {
  const previous = [
    {
      inviteeActorId: invitee,
      generation: 3,
      state: 'declined',
      invitedAt: new Date(now),
    },
  ];
  assert({
    given: 'declined invitation under a fresh canonical issuance fence',
    should:
      'renew the explicit association generation without changing prior facts',
    actual: [planGroupIssuance({ ...base, previous }), previous[0]?.generation],
    expected: [
      [{ inviteeActorId: invitee, generation: 4, expectedGeneration: 3 }],
      3,
    ],
  });
});
test('invitation effects refuse duplicate pending or active participants and explicit capacity exhaustion', async () => {
  for (const input of [
    {
      ...base,
      previous: [
        {
          inviteeActorId: invitee,
          generation: 1,
          state: 'pending',
          invitedAt: new Date(now),
        },
      ],
    },
    { ...base, activeMemberActorIds: [actor, invitee] },
    { ...base, maxMembers: 1 },
    { ...base, maxPendingInvitations: 0 },
    {
      ...base,
      previous: [
        {
          inviteeActorId: invitee,
          generation: Number.MAX_SAFE_INTEGER,
          state: 'cancelled',
          invitedAt: new Date(now),
        },
      ],
    },
  ])
    await assertRejects({
      given: 'conflicting prospective invitation effects',
      should: 'refuse before any writes',
      actual: async () => planGroupIssuance(input),
      code: 'CONFLICT',
    });
});
